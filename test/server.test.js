import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

import {
  ROUTE_BASE,
  makeHandler,
  parseRange,
  signToken,
  mediaKindOf,
  mimeOf,
} from '../lib/server.js'

const SECRET = 'test-secret'

function makeStore() {
  const calls = { record: [], clear: 0 }
  return {
    calls,
    list: async () => [{ path: '/tmp/a.mp4', real: '/tmp/a.mp4', title: 'a.mp4', kind: 'video', missing: false }],
    record: async (input) => {
      calls.record.push(input)
      return []
    },
    clear: async () => {
      calls.clear += 1
      return []
    },
  }
}

async function withServer(options, run) {
  const store = options.store || makeStore()
  const handler = makeHandler({
    store,
    secret: SECRET,
    getConnection: () => undefined,
    getOwnHost: () => '',
    log: () => {},
    ...options,
  })
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500)
      res.end(String(error && error.message))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run({ port, base: `http://127.0.0.1:${port}`, store })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function tempMedia(bytes = '0123456789', name = 'clip.mp4') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmt-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, bytes)
  return { dir, file, real: fs.realpathSync(file) }
}

function rawRequest(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET', headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('parseRange handles the common forms', () => {
  assert.equal(parseRange('', 100), null)
  assert.equal(parseRange('bytes=0-9', 100).start, 0)
  assert.equal(parseRange('bytes=0-9', 100).end, 9)
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable')
  assert.equal(parseRange('bytes=5-1', 100), null)
  assert.equal(parseRange('bytes=0-1,3-4', 100), null)
})

test('media type helpers', () => {
  assert.equal(mediaKindOf('/a/b.mp4'), 'video')
  assert.equal(mediaKindOf('/a/b.MP3'), 'audio')
  assert.equal(mediaKindOf('/a/b.txt'), null)
  assert.equal(mimeOf('/a/b.mov'), 'video/quicktime')
  assert.equal(mimeOf('/a/b.unknown'), '')
})

test('unsigned preview route streams the whole file', async () => {
  const media = tempMedia('hello-media')
  await withServer({}, async ({ base }) => {
    const response = await fetch(`${base}${ROUTE_BASE}/preview?p=${encodeURIComponent(media.real)}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(await response.text(), 'hello-media')
  })
})

test('HEAD reports the size without a body', async () => {
  const media = tempMedia('0123456789')
  await withServer({}, async ({ base }) => {
    const response = await fetch(`${base}${ROUTE_BASE}/preview?p=${encodeURIComponent(media.real)}`, { method: 'HEAD' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-length'), '10')
    assert.equal(await response.text(), '')
  })
})

test('Range requests return 206 with Content-Range', async () => {
  const media = tempMedia('0123456789')
  await withServer({}, async ({ base }) => {
    const url = `${base}${ROUTE_BASE}/preview?p=${encodeURIComponent(media.real)}`
    const first = await fetch(url, { headers: { Range: 'bytes=0-3' } })
    assert.equal(first.status, 206)
    assert.equal(first.headers.get('content-range'), 'bytes 0-3/10')
    assert.equal(await first.text(), '0123')

    const tail = await fetch(url, { headers: { Range: 'bytes=-4' } })
    assert.equal(tail.status, 206)
    assert.equal(await tail.text(), '6789')

    const open = await fetch(url, { headers: { Range: 'bytes=6-' } })
    assert.equal(open.status, 206)
    assert.equal(await open.text(), '6789')
  })
})

test('out-of-range requests return 416', async () => {
  const media = tempMedia('0123456789')
  await withServer({}, async ({ base }) => {
    const response = await fetch(`${base}${ROUTE_BASE}/preview?p=${encodeURIComponent(media.real)}`, {
      headers: { Range: 'bytes=99-' },
    })
    assert.equal(response.status, 416)
    assert.equal(response.headers.get('content-range'), 'bytes */10')
  })
})

test('signed media route requires a matching token', async () => {
  const media = tempMedia('signed-bytes')
  await withServer({}, async ({ base }) => {
    const signed = await (await fetch(`${base}${ROUTE_BASE}/api/sign?p=${encodeURIComponent(media.real)}`)).json()
    const ok = await fetch(signed.url)
    assert.equal(ok.status, 200)
    assert.equal(await ok.text(), 'signed-bytes')

    const bad = await fetch(signed.url.replace(/t=[0-9a-f]+/, 't=deadbeef'))
    assert.equal(bad.status, 403)

    const unsigned = new URL(signed.url)
    unsigned.searchParams.delete('t')
    const missing = await fetch(unsigned.toString())
    assert.equal(missing.status, 403)
  })
})

test('sign API returns an absolute, working media URL', async () => {
  const media = tempMedia('signed-now')
  await withServer({}, async ({ base }) => {
    const response = await fetch(`${base}${ROUTE_BASE}/api/sign?p=${encodeURIComponent(media.real)}`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.kind, 'video')
    assert.match(body.url, /^http:\/\/127\.0\.0\.1:\d+\/dsh-media-tab\/media\?t=[0-9a-f]{32}&p=/)

    const part = await fetch(body.url, { headers: { Range: 'bytes=0-5' } })
    assert.equal(part.status, 206)
    assert.equal(await part.text(), 'signed')
  })
})

test('sign API still requires the connection fence', async () => {
  const media = tempMedia('nope')
  await withServer({}, async ({ port }) => {
    const target = `${ROUTE_BASE}/api/sign?p=${encodeURIComponent(media.real)}`
    const crossSite = await rawRequest(port, target, { 'sec-fetch-site': 'cross-site' })
    assert.equal(crossSite.status, 403)
  })
})

test('signed media bypasses the shell fence but not the token', async () => {
  const media = tempMedia('desktop-media')
  await withServer({}, async ({ port, base }) => {
    const signed = await (await fetch(`${base}${ROUTE_BASE}/api/sign?p=${encodeURIComponent(media.real)}`)).json()
    const target = new URL(signed.url).pathname + new URL(signed.url).search
    // The desktop shell reaches the host from dsh-app://, so these headers
    // look cross-site even though the request is trusted by the token.
    const allowed = await rawRequest(port, target, {
      'sec-fetch-site': 'cross-site',
      origin: 'dsh-app://app',
    })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.body, 'desktop-media')

    const denied = await rawRequest(port, target.replace(/t=[0-9a-f]+/, 't=bad'), {
      'sec-fetch-site': 'cross-site',
    })
    assert.equal(denied.status, 403)
  })
})

test('non-media extensions are refused even with a valid token', async () => {
  const file = tempMedia('secret', 'notes.txt')
  await withServer({}, async ({ base }) => {
    const token = signToken(SECRET, file.real)
    const response = await fetch(`${base}${ROUTE_BASE}/media?t=${token}&p=${encodeURIComponent(file.real)}`)
    assert.equal(response.status, 403)
  })
})

test('missing files return 404', async () => {
  await withServer({}, async ({ base }) => {
    const missing = path.join(os.tmpdir(), 'dmt-does-not-exist.mp4')
    const response = await fetch(`${base}${ROUTE_BASE}/preview?p=${encodeURIComponent(missing)}`)
    assert.equal(response.status, 404)
  })
})

test('cross-site and foreign-origin requests are fenced', async () => {
  const media = tempMedia('fence')
  await withServer({}, async ({ port }) => {
    const target = `${ROUTE_BASE}/preview?p=${encodeURIComponent(media.real)}`
    const crossSite = await rawRequest(port, target, { 'sec-fetch-site': 'cross-site' })
    assert.equal(crossSite.status, 403)

    const foreign = await rawRequest(port, target, { origin: 'http://evil.example' })
    assert.equal(foreign.status, 403)

    const rebound = await rawRequest(port, target, { host: 'evil.example' })
    assert.equal(rebound.status, 403)
  })
})

test('health probe answers without auth but with the fence', async () => {
  await withServer({}, async ({ base }) => {
    const response = await fetch(`${base}${ROUTE_BASE}/api/health`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.name, 'dsh-media-tab')
  })
})

test('recent API reads, records and clears', async () => {
  const store = makeStore()
  await withServer({ store }, async ({ base }) => {
    const list = await fetch(`${base}${ROUTE_BASE}/api/recent`)
    assert.equal(list.status, 200)
    assert.equal((await list.json()).items.length, 1)

    const recorded = await fetch(`${base}${ROUTE_BASE}/api/recent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/a.mp4', event: 'play' }),
    })
    assert.equal(recorded.status, 200)
    assert.equal(store.calls.record.length, 1)
    assert.equal(store.calls.record[0].path, '/tmp/a.mp4')

    const cleared = await fetch(`${base}${ROUTE_BASE}/api/recent/clear`, { method: 'POST' })
    assert.equal(cleared.status, 200)
    assert.equal(store.calls.clear, 1)
  })
})

test('recent API rejects malformed and oversized bodies', async () => {
  await withServer({}, async ({ base }) => {
    const malformed = await fetch(`${base}${ROUTE_BASE}/api/recent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    assert.equal(malformed.status, 400)

    const oversized = await fetch(`${base}${ROUTE_BASE}/api/recent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(32 * 1024),
    })
    assert.equal(oversized.status, 400)
  })
})

test('unknown routes return 404 and wrong methods 405', async () => {
  await withServer({}, async ({ base }) => {
    assert.equal((await fetch(`${base}${ROUTE_BASE}/nope`)).status, 404)
    assert.equal((await fetch(`${base}${ROUTE_BASE}/api/recent`, { method: 'DELETE' })).status, 405)
    assert.equal((await fetch(`${base}${ROUTE_BASE}/api/recent/clear`)).status, 405)
  })
})
