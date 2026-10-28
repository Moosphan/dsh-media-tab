import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Never touch the real ~/.dsh while testing (secret + recent store live there).
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dmt-home-'))

function mediaFile(name = 'clip.mp4', bytes = 'fake-media') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmt-plugin-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, bytes)
  return { dir, file: fs.realpathSync(file) }
}

test('host plugin mounts a route and the play_media tool', async () => {
  const { apply } = await import('../lib/index.js')
  const routes = []
  const tools = []
  const appended = []
  const { dir, file } = mediaFile()

  const session = {
    header: { cwd: dir },
    append: (event, payload) => appended.push({ event, payload }),
  }
  const ctx = {
    effect: (fn) => fn(),
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:55580',
    },
    tools: { register: (tool) => tools.push(tool) },
    get: (name) => (name === 'sessionProjections'
      ? { stateOf: (_session, key) => (key === 'turnBoundary' ? { lastTurn: 4 } : dir) }
      : undefined),
    logger: { warn: () => {} },
  }

  apply(ctx)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/dsh-media-tab')
  assert.equal(tools.length, 1)

  const tool = tools[0]
  assert.equal(tool.name, 'play_media')
  assert.deepEqual(tool.parameters.required, ['path'])
  assert.equal(typeof tool.execute, 'function')

  const value = await tool.execute({ path: file, title: 'Demo' }, { agent: { session }, callId: 'call-1' })

  assert.equal(value.kind, 'video')
  assert.equal(value.name, 'clip.mp4')
  assert.equal(path.basename(value.path), 'clip.mp4')
  assert.ok(fs.existsSync(value.path))
  assert.match(value.url, /^http:\/\/127\.0\.0\.1:55580\/dsh-media-tab\/media\?t=[0-9a-f]{32}&p=.*&v=\d+/)
  assert.match(value.text, /clip\.mp4/)

  assert.equal(appended.length, 1)
  assert.equal(appended[0].event, 'deliverables/presented')
  assert.equal(appended[0].payload.turn, 4)
  assert.equal(appended[0].payload.callId, 'call-1')
  assert.equal(path.basename(appended[0].payload.files[0].path), 'clip.mp4')
  assert.ok(fs.existsSync(appended[0].payload.files[0].path))
  assert.equal(appended[0].payload.files[0].title, 'Demo')
})

test('play_media resolves relative paths against the session cwd', async () => {
  const { apply } = await import('../lib/index.js')
  const tools = []
  const { dir } = mediaFile()
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: () => () => {}, getOrigin: () => '' },
    tools: { register: (tool) => tools.push(tool) },
    get: () => undefined,
    logger: { warn: () => {} },
  }
  apply(ctx)

  const value = await tools[0].execute(
    { path: 'clip.mp4' },
    { agent: { session: { header: { cwd: dir } } } },
  )
  assert.equal(value.kind, 'video')
  assert.equal(path.basename(value.path), 'clip.mp4')
  assert.ok(fs.existsSync(value.path))
})

test('play_media explains unsupported containers instead of pretending', async () => {
  const { apply } = await import('../lib/index.js')
  const tools = []
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: () => () => {}, getOrigin: () => '' },
    tools: { register: (tool) => tools.push(tool) },
    get: () => undefined,
    logger: { warn: () => {} },
  }
  apply(ctx)
  const { file } = mediaFile('old.avi', 'fake')

  await assert.rejects(
    () => tools[0].execute({ path: file }, { agent: { session: { header: { cwd: path.dirname(file) } } } }),
    /cannot decode \.avi[\s\S]*ffmpeg/,
  )
})

test('play_media rejects missing files and empty paths', async () => {
  const { apply } = await import('../lib/index.js')
  const tools = []
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: () => () => {}, getOrigin: () => '' },
    tools: { register: (tool) => tools.push(tool) },
    get: () => undefined,
    logger: { warn: () => {} },
  }
  apply(ctx)

  await assert.rejects(() => tools[0].execute({}, {}), /path is required/)
  await assert.rejects(
    () => tools[0].execute({ path: '/definitely/not/here.mp4' }, {}),
    /File not found/,
  )
})

/* ── client smoke: load the browser bundle with a tiny React/DOM stub ────── */

function loadClient() {
  const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  let loaded = null
  const document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, textContent: '', appendChild() {} }),
    head: { appendChild() {} },
    querySelectorAll: () => [],
  }
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    fetch: async () => ({ ok: true, json: async () => ({ items: [] }), headers: { get: () => '' } }),
    window: {
      __ModuleLoader__: {
        load: (definition) => { loaded = definition },
      },
    },
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(loaded, 'client bundle did not call __ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-media-tab')

  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), ...(children.length ? { children } : {}) },
    }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const require = (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  }
  return loaded.factory(require)
}

function renderNode(node, depth = 0) {
  if (node === null || node === undefined || depth > 20) return
  if (Array.isArray(node)) {
    for (const child of node) renderNode(child, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    renderNode(node.type(node.props || {}), depth + 1)
    return
  }
  if (node.props && node.props.children) renderNode(node.props.children, depth + 1)
}

test('client bundle registers the preview renderer and both slots', () => {
  const client = loadClient()
  assert.deepEqual([...client.inject], ['slots', 'locale', 'documentPreviews'])

  const previews = []
  const slots = []
  const locales = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: (ns, dict) => locales.push({ ns, dict }), t: () => '' },
    documentPreviews: { register: (definition) => previews.push(definition) },
    slots: {
      inject: (_name, callback) => callback(),
      register: (definition, component) => {
        slots.push({ definition, component })
        return () => {}
      },
    },
  }

  client.apply(ctx)

  assert.equal(previews.length, 1)
  assert.equal(previews[0].id, 'dsh-media-tab')
  assert.equal(previews[0].loading, 'renderer')
  assert.ok(previews[0].extensions.includes('mp4'))
  assert.ok(previews[0].extensions.includes('mp3'))

  assert.deepEqual(
    slots.map((entry) => entry.definition.name).sort(),
    ['conversation.chat.turnTail', 'sidebar.right.tab.document'],
  )
  assert.equal(locales.length, 1)
  assert.ok(locales[0].dict.zh && locales[0].dict.en)
})

test('client components render without throwing', () => {
  const client = loadClient()
  const slots = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {}, t: () => '' },
    documentPreviews: { register: () => {} },
    slots: {
      inject: (_name, callback) => callback(),
      register: (definition, component) => {
        slots.push({ definition, component })
        return () => {}
      },
    },
  }
  client.apply(ctx)

  const t = (key, fallback) => fallback || key
  const tab = slots.find((entry) => entry.definition.name === 'sidebar.right.tab.document')
  const tail = slots.find((entry) => entry.definition.name === 'conversation.chat.turnTail')

  renderNode(tab.component({
    resourceAddress: 'dsh-resource://file/session/s1//tmp/clip.mp4',
    useResource: () => ({ status: 'ok', value: { absolutePath: '/tmp/clip.mp4' } }),
    content: { kind: 'renderer', loaded: () => {}, failed: () => {} },
    t,
  }))

  renderNode(tail.component({
    turn: {
      data: {
        get: (key) => (key === 'deliverables' ? { presented: [{ path: '/tmp/a.mp4' }, { path: '/tmp/b.mp3' }, { path: '/tmp/c.txt' }] } : undefined),
      },
    },
    openFile: () => {},
    t,
  }))

  // Missing path falls back to the placeholder, not a crash.
  renderNode(tab.component({ resourceAddress: '', useResource: () => undefined, t }))
})
