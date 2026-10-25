/**
 * dsh-media-tab — host-side HTTP layer (pure, unit-testable).
 *
 * One prefix route serves everything under /dsh-media-tab:
 *
 *   GET|HEAD /dsh-media-tab/media?p=/abs/file&t=<hmac>   signed link (tool output)
 *   GET|HEAD /dsh-media-tab/preview?p=/abs/file          UI route (login cookie gate)
 *   GET      /dsh-media-tab/api/health                   route readiness probe
 *   GET      /dsh-media-tab/api/recent                   recent list
 *   POST     /dsh-media-tab/api/recent                   record a play / progress
 *   POST     /dsh-media-tab/api/recent/clear             clear the list
 *
 * The DSH web server itself does not authenticate; every route here has to
 * fence for itself: Host / Sec-Fetch-Site / Origin, then the DSH connection
 * cookie (or loopback-only when that service is absent). Media bytes are
 * streamed with HTTP Range so seeking a large file never loads it in memory.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream'

export const VERSION = '0.1.0'
export const ROUTE_BASE = '/dsh-media-tab'

/** Playable in Chromium. Anything else is rejected with a convert hint. */
const MIME = {
  '.mp4': ['video/mp4', 'video'],
  '.m4v': ['video/mp4', 'video'],
  '.mov': ['video/quicktime', 'video'],
  '.webm': ['video/webm', 'video'],
  '.ogv': ['video/ogg', 'video'],
  '.mkv': ['video/x-matroska', 'video'],
  '.3gp': ['video/3gpp', 'video'],
  '.mp3': ['audio/mpeg', 'audio'],
  '.wav': ['audio/wav', 'audio'],
  '.ogg': ['audio/ogg', 'audio'],
  '.oga': ['audio/ogg', 'audio'],
  '.m4a': ['audio/mp4', 'audio'],
  '.aac': ['audio/aac', 'audio'],
  '.flac': ['audio/flac', 'audio'],
  '.opus': ['audio/ogg', 'audio'],
  '.weba': ['audio/webm', 'audio'],
}

export const MEDIA_EXTENSIONS = Object.keys(MIME).map((ext) => ext.slice(1))
export const AUDIO_EXTENSIONS = Object.entries(MIME)
  .filter(([, value]) => value[1] === 'audio')
  .map(([ext]) => ext.slice(1))
export const VIDEO_EXTENSIONS = Object.entries(MIME)
  .filter(([, value]) => value[1] === 'video')
  .map(([ext]) => ext.slice(1))

export function mediaKindOf(file) {
  if (typeof file !== 'string' || file === '') return null
  const entry = MIME[path.extname(file).toLowerCase()]
  return entry ? entry[1] : null
}

export function mimeOf(file) {
  const entry = MIME[path.extname(String(file || '')).toLowerCase()]
  return entry ? entry[0] : ''
}

export function isMediaFile(file) {
  return mediaKindOf(file) !== null
}

export function dshHome() {
  const configured = String(process.env.DSH_HOME || '').trim()
  return configured || path.join(os.homedir(), '.dsh')
}

export function cacheDir(...segments) {
  return path.join(dshHome(), 'cache', 'dsh-media-tab', ...segments)
}

/** Persistent per-machine signing secret (0600). URLs survive restarts. */
export function loadSecret(file = cacheDir('secret')) {
  try {
    const value = fs.readFileSync(file, 'utf8').trim()
    if (value) return value
  } catch {
    /* first run */
  }
  const value = crypto.randomBytes(32).toString('hex')
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, value, { mode: 0o600 })
  } catch {
    /* unwritable cache: fall back to an in-process secret */
  }
  return value
}

export function signToken(secret, realFile) {
  return crypto.createHmac('sha256', String(secret)).update(String(realFile)).digest('hex').slice(0, 32)
}

export function verifyToken(secret, realFile, token) {
  const want = Buffer.from(signToken(secret, realFile))
  const got = Buffer.from(String(token || ''))
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

/**
 * Parse a single-range `Range` header.
 * Returns null (send the whole file), 'unsatisfiable', or { start, end }.
 * Multi-range requests degrade to the whole file on purpose.
 */
export function parseRange(header, total) {
  if (!header || !Number.isFinite(total) || total <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1)
  if (!Number.isFinite(start) || start >= total) return 'unsatisfiable'
  if (end < start) return null
  return { start, end }
}

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const LOOPBACK_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopbackAddress(address) {
  return LOOPBACK_ADDR.has(String(address || ''))
}

/** Host / Sec-Fetch-Site / Origin — the same fence DSH's own routes use. */
export function fenceOk(req, ownHost = '') {
  const host = String(req.headers.host || '')
  if (!LOOPBACK_HOST.test(host) && host !== ownHost) return false
  if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Absolute origin of the request, honouring reverse-proxy headers. */
export function requestOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const protocol = forwarded || (req.socket && req.socket.encrypted ? 'https' : 'http')
  const host = String(req.headers.host || '')
  return host ? `${protocol}://${host}` : ''
}

function sendText(res, code, text) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Dsh-Media-Tab': VERSION,
  })
  res.end(text)
}

function sendJson(res, code, value) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Dsh-Media-Tab': VERSION,
  })
  res.end(JSON.stringify(value))
}

function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return reject(new Error('body too large'))
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

/** Resolve a requested path to a readable regular media file, or an error code. */
async function resolveMedia(rawPath) {
  const value = String(rawPath || '')
  if (!value || !path.isAbsolute(value)) return { error: 403 }
  if (!isMediaFile(value)) return { error: 403 }
  let real
  let stat
  try {
    real = await fs.promises.realpath(value)
    stat = await fs.promises.stat(real)
  } catch {
    return { error: 404 }
  }
  if (!stat.isFile() || !isMediaFile(real)) return { error: 403 }
  try {
    await fs.promises.access(real, fs.constants.R_OK)
  } catch {
    return { error: 403 }
  }
  return { real, stat }
}

function streamMedia(req, res, { real, stat }) {
  const total = stat.size
  const headers = {
    'Content-Type': mimeOf(real) || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Dsh-Media-Tab': VERSION,
  }
  const range = parseRange(req.headers.range, total)
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${total}` })
    res.end()
    return
  }
  if (range) {
    res.writeHead(206, {
      ...headers,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
    })
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': total })
  }
  if (req.method === 'HEAD' || total === 0) {
    res.end()
    return
  }
  const stream = range
    ? fs.createReadStream(real, { start: range.start, end: range.end })
    : fs.createReadStream(real)
  // A mid-stream read error must only end this response, never the host.
  pipeline(stream, res, () => {})
}

function authorize(req, getConnection) {
  let connection
  try {
    connection = getConnection ? getConnection() : undefined
  } catch {
    connection = undefined
  }
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req)
      return rejection || 0
    } catch {
      return isLoopbackAddress(req.socket && req.socket.remoteAddress) ? 0 : 403
    }
  }
  return isLoopbackAddress(req.socket && req.socket.remoteAddress) ? 0 : 403
}

/**
 * Build the request handler.
 *
 * @param {object} options
 * @param {{ list: Function, record: Function, clear: Function }} options.store
 * @param {string} options.secret
 * @param {() => object | undefined} [options.getConnection]
 * @param {() => string} [options.getOwnHost]
 * @param {(error: unknown) => void} [options.log]
 */
export function makeHandler({ store, secret, getConnection, getOwnHost, log }) {
  const ownHost = () => {
    try {
      return getOwnHost ? String(getOwnHost() || '') : ''
    } catch {
      return ''
    }
  }

  return async function handler(req, res) {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      return sendText(res, 400, 'bad request')
    }
    const pathname = url.pathname

    /**
     * Signed media route. The token IS the authorization: the desktop shell
     * forwards dsh-app:// requests through Node fetch, which drops
     * Content-Length from every response, and Chromium then treats the media
     * as an unbounded stream (seeking disabled). The player therefore loads
     * media from the absolute host origin, where this route is reached
     * without the shell cookie, so only the HMAC token can gate it.
     */
    const respondWithMedia = async (requireToken) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed')
      const requested = url.searchParams.get('p') || ''
      const media = await resolveMedia(requested)
      if (media.error) return sendText(res, media.error, media.error === 404 ? 'not found' : 'forbidden')
      if (requireToken && !verifyToken(secret, media.real, url.searchParams.get('t'))) {
        return sendText(res, 403, 'forbidden')
      }
      return streamMedia(req, res, media)
    }

    if (pathname === `${ROUTE_BASE}/media`) return respondWithMedia(true)

    if (!fenceOk(req, ownHost())) return sendText(res, 403, 'forbidden')

    if (pathname === `${ROUTE_BASE}/api/health`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed')
      return sendJson(res, 200, { ok: true, name: 'dsh-media-tab', version: VERSION })
    }

    const rejection = authorize(req, getConnection)
    if (rejection) return sendText(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')

    try {
      if (pathname === `${ROUTE_BASE}/preview`) return respondWithMedia(false)

      if (pathname === `${ROUTE_BASE}/api/sign`) {
        if (req.method !== 'GET') return sendText(res, 405, 'method not allowed')
        const requested = url.searchParams.get('p') || ''
        const media = await resolveMedia(requested)
        if (media.error) {
          return sendJson(res, media.error, { ok: false, error: media.error === 404 ? 'not found' : 'forbidden' })
        }
        const token = signToken(secret, media.real)
        const origin = requestOrigin(req)
        return sendJson(res, 200, {
          ok: true,
          url: `${origin}${ROUTE_BASE}/media?t=${token}&p=${encodeURIComponent(media.real)}`,
          kind: mediaKindOf(media.real),
          name: path.basename(media.real),
          size: media.stat.size,
        })
      }

      if (pathname === `${ROUTE_BASE}/api/recent`) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const items = await store.list()
          return sendJson(res, 200, { ok: true, items })
        }
        if (req.method === 'POST') {
          let body
          try {
            body = await readJsonBody(req)
          } catch (error) {
            return sendJson(res, 400, { ok: false, error: String(error && error.message) })
          }
          try {
            const items = await store.record(body || {})
            return sendJson(res, 200, { ok: true, items })
          } catch (error) {
            const code = error && error.code
            if (code === 'unsupported' || code === 'invalid') return sendJson(res, 400, { ok: false, error: String(error.message) })
            if (code === 'missing') return sendJson(res, 404, { ok: false, error: String(error.message) })
            throw error
          }
        }
        return sendText(res, 405, 'method not allowed')
      }

      if (pathname === `${ROUTE_BASE}/api/recent/clear`) {
        if (req.method !== 'POST') return sendText(res, 405, 'method not allowed')
        await store.clear()
        return sendJson(res, 200, { ok: true, items: [] })
      }

      return sendText(res, 404, 'not found')
    } catch (error) {
      if (log) log(error)
      return sendJson(res, 500, { ok: false, error: 'internal error' })
    }
  }
}
