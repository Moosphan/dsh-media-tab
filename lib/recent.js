/**
 * Recent-play store: one JSON file under the DSH cache directory.
 *
 * Deliberately small: no folders, no favourites, no search. Just the last
 * `limit` files that were actually played, newest first, plus enough metadata
 * for the list to render without touching the media files again.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cacheDir, mediaKindOf } from './server.js'

const SCHEMA_VERSION = 1
const MAX_ITEMS = 20

export function defaultRecentFile() {
  return cacheDir('recent.json')
}

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function baseName(file) {
  return path.basename(String(file || '')) || String(file || '')
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const real = typeof raw.real === 'string' ? raw.real : ''
  const storedPath = typeof raw.path === 'string' ? raw.path : ''
  if (!real && !storedPath) return null
  const realPath = real || storedPath
  return {
    path: storedPath || realPath,
    real: realPath,
    title: typeof raw.title === 'string' && raw.title ? raw.title : baseName(realPath),
    kind: raw.kind === 'audio' ? 'audio' : 'video',
    size: asNumber(raw.size),
    mtimeMs: asNumber(raw.mtimeMs),
    duration: asNumber(raw.duration),
    position: asNumber(raw.position),
    plays: asNumber(raw.plays),
    addedAt: asNumber(raw.addedAt),
    lastPlayedAt: asNumber(raw.lastPlayedAt),
  }
}

async function statSafe(file) {
  try {
    return await fs.promises.stat(file, { signal: AbortSignal.timeout(800) })
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    // Timeout or transient error: keep the entry but do not mark it missing.
    return undefined
  }
}

export class RecentStore {
  constructor({ file = defaultRecentFile(), limit = MAX_ITEMS, now = () => Date.now() } = {}) {
    this.file = file
    this.limit = Math.max(1, Math.min(100, Number(limit) || MAX_ITEMS))
    this.now = now
    this.items = null
    this.loading = null
    this.chain = Promise.resolve()
    this.operations = Promise.resolve()
  }

  async _load() {
    if (this.items) return this.items
    if (this.loading) return this.loading
    this.loading = (async () => {
      let text = null
      try {
        text = await fs.promises.readFile(this.file, 'utf8')
      } catch {
        text = null
      }
      let parsed = null
      let corrupt = false
      if (text !== null) {
        try {
          parsed = JSON.parse(text)
        } catch {
          corrupt = true
        }
      }
      const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : []
      const items = []
      const seen = new Set()
      for (const raw of rawItems) {
        const item = normalizeItem(raw)
        if (!item || seen.has(item.real)) continue
        seen.add(item.real)
        items.push(item)
        if (items.length >= this.limit) break
      }
      if (corrupt) {
        // Keep the bytes aside for debugging instead of looping on a broken file.
        try {
          await fs.promises.rename(this.file, `${this.file}.corrupt-${Date.now()}`)
        } catch {
          /* ignore */
        }
      }
      this.items = items
      this.loading = null
      return items
    })()
    return this.loading
  }

  async list() {
    const items = await this._load()
    const checked = await Promise.all(items.map(async (item) => {
      const stat = await statSafe(item.real)
      return { ...item, missing: stat === null }
    }))
    return checked
  }

  async record(input = {}) {
    // Serialize whole operations: concurrent records must merge, not race.
    const run = this.operations.then(() => this._record(input))
    this.operations = run.then(() => {}, () => {})
    return run
  }

  async _record(input = {}) {
    const file = String(input.path || '').trim()
    if (!file || !path.isAbsolute(file)) {
      throw Object.assign(new Error('path must be an absolute local path'), { code: 'invalid' })
    }
    let real
    let stat
    try {
      real = await fs.promises.realpath(file)
      stat = await fs.promises.stat(real)
    } catch {
      throw Object.assign(new Error(`file not found: ${file}`), { code: 'missing' })
    }
    const kind = mediaKindOf(real)
    if (!kind || !stat.isFile()) {
      throw Object.assign(new Error(`not a playable media file: ${file}`), { code: 'unsupported' })
    }

    const items = await this._load()
    const existing = items.find((item) => item.real === real)
    const now = this.now()
    const event = input.event === 'progress' ? 'progress' : 'play'
    const next = {
      path: real,
      real,
      title: baseName(real),
      kind,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      duration: asNumber(input.duration, existing ? existing.duration : 0),
      position: event === 'progress' ? asNumber(input.position, existing ? existing.position : 0) : 0,
      plays: (existing ? existing.plays : 0) + (event === 'play' ? 1 : 0),
      addedAt: existing ? existing.addedAt : now,
      lastPlayedAt: now,
    }

    const rest = items.filter((item) => item.real !== real)
    const merged = [next, ...rest].slice(0, this.limit)
    this.items = merged
    await this._persist()
    return merged
  }

  async clear() {
    const run = this.operations.then(() => this._clear())
    this.operations = run.then(() => {}, () => {})
    return run
  }

  async _clear() {
    this.items = []
    await this._persist()
    return []
  }

  _persist() {
    const snapshot = JSON.stringify({ v: SCHEMA_VERSION, items: this.items }, null, 2)
    this.chain = this.chain.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
      await fs.promises.writeFile(temp, snapshot, { mode: 0o600 })
      await fs.promises.rename(temp, this.file)
    })
    return this.chain
  }
}
