import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { RecentStore, defaultRecentFile } from '../lib/recent.js'

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmt-recent-'))
  return {
    dir,
    file: path.join(dir, 'recent.json'),
    media(name, bytes = 'media') {
      const target = path.join(dir, name)
      fs.writeFileSync(target, bytes)
      return fs.realpathSync(target)
    },
  }
}

test('default path lives under the DSH cache directory', () => {
  const target = defaultRecentFile()
  assert.match(target, /\.dsh|cache|dsh-media-tab/)
  assert.equal(path.basename(target), 'recent.json')
})

test('records newest first and enforces the limit', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file, limit: 3 })
  const files = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'].map((name) => ws.media(name))

  for (const file of files) await store.record({ path: file, event: 'play' })

  const items = await store.list()
  assert.equal(items.length, 3)
  assert.deepEqual(items.map((item) => path.basename(item.real)), ['d.mp4', 'c.mp4', 'b.mp4'])
  assert.equal(items[0].plays, 1)
  assert.equal(items[0].kind, 'video')
})

test('de-duplicates by real path and counts plays', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file })
  const file = ws.media('clip.mp4')

  await store.record({ path: file, event: 'play' })
  await store.record({ path: file, event: 'progress', position: 12, duration: 30 })
  await store.record({ path: file, event: 'play' })

  const items = await store.list()
  assert.equal(items.length, 1)
  assert.equal(items[0].plays, 2)
  assert.equal(items[0].position, 0, 'a play event resets the resume position')
})

test('stores progress without incrementing plays', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file })
  const file = ws.media('voice.mp3')

  await store.record({ path: file, event: 'progress', position: 4.5, duration: 99 })
  const items = await store.list()
  assert.equal(items[0].plays, 0)
  assert.equal(items[0].position, 4.5)
  assert.equal(items[0].duration, 99)
  assert.equal(items[0].kind, 'audio')
})

test('marks deleted files as missing but keeps the entry', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file })
  const file = ws.media('gone.mp4')

  await store.record({ path: file, event: 'play' })
  fs.rmSync(file)

  const items = await store.list()
  assert.equal(items.length, 1)
  assert.equal(items[0].missing, true)
})

test('rejects invalid, missing and non-media paths', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file })

  await assert.rejects(() => store.record({ path: 'relative/a.mp4' }), /absolute/i)
  await assert.rejects(() => store.record({ path: path.join(ws.dir, 'nope.mp4') }), /not found/i)

  const text = path.join(ws.dir, 'notes.txt')
  fs.writeFileSync(text, 'hi')
  await assert.rejects(() => store.record({ path: text }), /playable media/i)
})

test('clear empties the list and persists', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file })
  await store.record({ path: ws.media('a.mp4'), event: 'play' })
  await store.clear()

  const reloaded = new RecentStore({ file: ws.file })
  assert.deepEqual(await reloaded.list(), [])
})

test('recovers from corrupt JSON without losing the bytes', async () => {
  const ws = workspace()
  fs.mkdirSync(path.dirname(ws.file), { recursive: true })
  fs.writeFileSync(ws.file, '{ definitely not json')

  const store = new RecentStore({ file: ws.file })
  assert.deepEqual(await store.list(), [])

  const aside = fs.readdirSync(ws.dir).filter((name) => name.startsWith('recent.json.corrupt-'))
  assert.equal(aside.length, 1)
})

test('writes atomically and leaves no temp files', async () => {
  const ws = workspace()
  const store = new RecentStore({ file: ws.file })
  await Promise.all([
    store.record({ path: ws.media('a.mp4'), event: 'play' }),
    store.record({ path: ws.media('b.mp4'), event: 'play' }),
    store.record({ path: ws.media('c.mp4'), event: 'play' }),
  ])

  const names = fs.readdirSync(ws.dir)
  assert.equal(names.some((name) => name.endsWith('.tmp')), false)
  const parsed = JSON.parse(fs.readFileSync(ws.file, 'utf8'))
  assert.equal(parsed.v, 1)
  assert.equal(parsed.items.length, 3)
})

test('a fresh store reloads persisted items', async () => {
  const ws = workspace()
  const file = ws.media('persisted.m4a')
  await new RecentStore({ file: ws.file }).record({ path: file, event: 'play' })

  const items = await new RecentStore({ file: ws.file }).list()
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'persisted.m4a')
})
