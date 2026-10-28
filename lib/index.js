/**
 * dsh-media-tab — host half.
 *
 * Registers one prefix route (streaming + recent-list API) and the `play_media`
 * tool. The tool validates the file, returns a signed streaming URL, and appends
 * the same `deliverables/presented` event the official `present` tool uses, so
 * the inline player under the reply picks it up without any extra client wiring.
 *
 * No runtime dependencies and no ffmpeg: unsupported containers are reported
 * with a copyable convert command instead of being transcoded here.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ROUTE_BASE,
  makeHandler,
  loadSecret,
  signToken,
  mediaKindOf,
  MEDIA_EXTENSIONS,
} from './server.js'
import { RecentStore, defaultRecentFile } from './recent.js'

export const name = 'dsh-media-tab'
export const inject = ['tools', 'webServer']

const TOOL_NAME = 'play_media'

function expandHome(value) {
  const raw = String(value || '').trim()
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

function resolvePath(raw, cwd) {
  const expanded = expandHome(raw)
  if (path.isAbsolute(expanded)) return path.resolve(expanded)
  return cwd ? path.resolve(cwd, expanded) : ''
}

function sessionCwd(ctx, session) {
  let cwd = ''
  try {
    const projections = ctx.get('sessionProjections')
    cwd = projections && typeof projections.stateOf === 'function'
      ? projections.stateOf(session, 'workingDirectory')
      : ''
  } catch {
    cwd = ''
  }
  if (typeof cwd !== 'string' || !cwd) cwd = session && session.header && session.header.cwd
  return typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : ''
}

function originOf(ctx) {
  try {
    return new URL(ctx.webServer.getOrigin()).origin
  } catch {
    return ''
  }
}

function formatSize(bytes) {
  const size = Number(bytes) || 0
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(size / 1024)} KB`
}

function presentMedia(ctx, exec, file, args) {
  const session = exec && exec.agent && exec.agent.session
  if (!session || typeof session.append !== 'function') return
  let boundary
  try {
    const projections = ctx.get('sessionProjections')
    boundary = projections && typeof projections.stateOf === 'function'
      ? projections.stateOf(session, 'turnBoundary')
      : undefined
  } catch {
    boundary = undefined
  }
  if (!boundary || !Number.isInteger(boundary.lastTurn)) return
  session.append('deliverables/presented', {
    turn: boundary.lastTurn,
    callId: (exec && exec.callId) || TOOL_NAME,
    files: [{
      path: file,
      description: `▶️ ${path.basename(file)}`,
      ...(args.title ? { title: String(args.title) } : {}),
      ...(args.autoplay ? { autoplay: true } : {}),
      ...(args.loop ? { loop: true } : {}),
    }],
  })
}

function createPlayMediaTool(ctx, secret) {
  return {
    name: TOOL_NAME,
    description:
      'Play a local video or audio file inside DSH: the player appears in the conversation ' +
      'and can also be opened in the right sidebar. Use it when the user wants to watch or ' +
      'listen to an existing local file. Media files this turn wrote (recordings, conversions, ' +
      `voiceovers) do not need this call — presenting them is enough. Playable: ${MEDIA_EXTENSIONS.join(' ')}. ` +
      'Other containers are rejected with a convert command.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the local media file (a leading ~ and session-relative paths are accepted).',
        },
        title: {
          type: 'string',
          description: 'Optional display title. Defaults to the file name.',
        },
        autoplay: {
          type: 'boolean',
          description: 'Optional: ask the inline player to start automatically (browsers may block it).',
        },
        loop: {
          type: 'boolean',
          description: 'Optional: loop playback.',
        },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          url: { type: 'string' },
          kind: { type: 'string', enum: ['video', 'audio'] },
          name: { type: 'string' },
          size: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['text', 'url', 'kind', 'name', 'size', 'path'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const raw = String((args && args.path) || '').trim()
      if (!raw) throw new Error('path is required')
      const cwd = sessionCwd(ctx, exec && exec.agent && exec.agent.session)
      const file = resolvePath(raw, cwd)
      if (!file) {
        throw new Error(`Cannot resolve a relative path without a session working directory: ${raw}. Pass an absolute path.`)
      }

      let stat
      try {
        stat = await fs.promises.stat(file)
      } catch {
        throw new Error(`File not found: ${file}`)
      }
      if (!stat.isFile()) throw new Error(`Not a file: ${file}`)

      let real
      try {
        real = await fs.promises.realpath(file)
      } catch {
        throw new Error(`Cannot read the file: ${file}`)
      }

      const kind = mediaKindOf(real)
      if (!kind) {
        const extension = path.extname(real).toLowerCase() || '(none)'
        throw new Error(
          `DSH plays media through Chromium and cannot decode ${extension}. Convert it first, for example:\n` +
          `ffmpeg -i "${real}" -c:v libx264 -c:a aac -movflags +faststart "${real.replace(/\.[^.]+$/, '')}.mp4"\n` +
          `(audio: ffmpeg -i "${real}" -c:a aac "${real.replace(/\.[^.]+$/, '')}.m4a")`,
        )
      }

      const token = signToken(secret, real)
      // Absolute host origin: the desktop shell's dsh-app:// forwarder strips
      // Content-Length, which disables media seeking. Direct HTTP keeps Range.
      const url = `${originOf(ctx)}${ROUTE_BASE}/media?t=${token}&p=${encodeURIComponent(real)}&v=${Math.round(stat.mtimeMs)}`
      const label = (args && args.title) || path.basename(real)

      try {
        presentMedia(ctx, exec, real, args || {})
      } catch (error) {
        try {
          ctx.logger && ctx.logger.warn && ctx.logger.warn(`dsh-media-tab: present failed: ${error && error.message}`)
        } catch {
          /* ignore */
        }
      }

      return {
        text: `▶️ ${label} (${kind}, ${formatSize(stat.size)})\n${url}`,
        url,
        kind,
        name: path.basename(real),
        size: formatSize(stat.size),
        path: real,
      }
    },
  }
}

export function apply(ctx) {
  const store = new RecentStore({ file: defaultRecentFile() })
  const secret = loadSecret()

  const handler = makeHandler({
    store,
    secret,
    getConnection: () => {
      try {
        return ctx.get('connection')
      } catch {
        return undefined
      }
    },
    getOwnHost: () => {
      try {
        return new URL(ctx.webServer.getOrigin()).host
      } catch {
        return ''
      }
    },
    log: (error) => {
      try {
        ctx.logger && ctx.logger.warn && ctx.logger.warn(`dsh-media-tab: ${error && error.message ? error.message : error}`)
      } catch {
        /* ignore */
      }
    },
  })

  const mount = () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_BASE, handler })
  if (typeof ctx.effect === 'function') ctx.effect(mount, 'dsh-media-tab: routes')
  else mount()

  ctx.tools.register(createPlayMediaTool(ctx, secret))
}
