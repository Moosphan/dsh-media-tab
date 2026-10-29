/**
 * dsh-media-tab — client half.
 *
 * Two mount points, one player component:
 *   conversation.chat.turnTail        → players under the reply for presented media
 *   sidebar.right.tab.document        → full player in the right sidebar, plus the
 *                                       minimal recent list
 *
 * Everything streams through the host route with HTTP Range; the browser element
 * is native `<video>`/`<audio>`, so seeking, volume, fullscreen and captions
 * affordances come from the platform instead of being reimplemented.
 */

window.__ModuleLoader__.load({
  id: 'dsh-media-tab',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    let React = null
    try {
      React = require('react')
    } catch {
      React = null
    }
    if (!React) {
      exports.apply = () => {}
      exports.inject = ['slots']
      return module.exports
    }

    const { useCallback, useEffect, useRef, useState } = React
    const h = React.createElement
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }

    const NS = 'dsh-media-tab'
    const BASE = '/dsh-media-tab'

    const MEDIA_RE = /\.(mp4|m4v|mov|webm|ogv|mkv|3gp|mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i
    const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i
    const UNPLAYABLE_RE = /\.(avi|flv|wmv|wma|asf|ts|mts|m2ts|mpg|mpeg|vob|rm|rmvb|amr|ape|ac3|eac3|dts|mid|midi)$/i
    const AUDIO_UNPLAYABLE = new Set(['.wma', '.amr', '.ape', '.mid', '.midi', '.ac3', '.eac3', '.dts'])

    const ZH = {
      rendererTitle: '媒体播放',
      preparing: '正在加载…',
      loading: '读取文件…',
      noPath: '拿不到文件路径',
      readFailed: '读不到文件信息',
      notFound: '文件不在了，可能被移走或删除',
      noAccess: '没有权限读取这个文件',
      noServer: '连不上播放服务。如果刚安装或更新过插件，请重启 DSH',
      unsupported: '这个格式 DSH 的播放器放不了。先转码：',
      decodeFailed: '解码失败：这个视频/音频的编码浏览器不支持',
      networkFailed: '读取文件失败，网络或磁盘出错',
      failed: '播放失败',
      retry: '重试',
      openInTab: '在侧栏打开',
      fullscreen: '全屏',
      exitFullscreen: '退出全屏',
      recent: '最近播放',
      recentEmpty: '还没有播放记录',
      clear: '清空',
      missing: '文件不存在',
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前',
      more: '还有 {n} 个',
      less: '收起',
      video: '视频',
      audio: '音频',
      copy: '复制命令',
      copied: '已复制',
    }

    const EN = {
      rendererTitle: 'Media player',
      preparing: 'Loading…',
      loading: 'Reading file…',
      noPath: 'No file path available',
      readFailed: 'Cannot read the file',
      notFound: 'The file is gone — it may have been moved or deleted',
      noAccess: 'No permission to read this file',
      noServer: 'Cannot reach the playback service. Restart DSH if the plugin was just installed or updated.',
      unsupported: 'DSH cannot play this container. Convert it first:',
      decodeFailed: 'Decode failed: the browser does not support this codec',
      networkFailed: 'Reading the file failed (network or disk)',
      failed: 'Playback failed',
      retry: 'Retry',
      openInTab: 'Open in sidebar',
      fullscreen: 'Fullscreen',
      exitFullscreen: 'Exit fullscreen',
      recent: 'Recently played',
      recentEmpty: 'Nothing played yet',
      clear: 'Clear',
      missing: 'Missing',
      justNow: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      daysAgo: '{n} d ago',
      more: '{n} more',
      less: 'Show less',
      video: 'Video',
      audio: 'Audio',
      copy: 'Copy command',
      copied: 'Copied',
    }

    function ensureStyle() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById('dsh-media-tab/style')
      if (existing) {
        // HMR re-evaluates the module but keeps the <style> tag: refresh it.
        existing.textContent = CSS
        return
      }
      const style = document.createElement('style')
      style.id = 'dsh-media-tab/style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    const CSS = `
.dmt-turn{display:flex;flex-direction:column;gap:8px;margin-top:4px;min-width:0}
.dmt-player{display:flex;flex-direction:column;min-width:0;border:.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}
.dmt-head{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#666);min-width:0}
.dmt-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--dsw-alias-label-primary,#111)}
.dmt-kind{flex:none;color:var(--dsw-alias-label-tertiary,#999)}
.dmt-action{flex:none;font:inherit;color:var(--dsw-alias-link,#4d6bfe);background:none;border:0;padding:2px 4px;border-radius:6px;cursor:pointer}
.dmt-action:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dmt-action:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:1px}
.dmt-media{display:block;width:100%;background:#000}
video.dmt-media{width:100%;height:auto;max-height:85vh;object-fit:contain;background:#000}
audio.dmt-media{background:transparent;padding:0 8px 8px}
.dmt-error{display:flex;flex-direction:column;gap:6px;padding:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d54941);background:var(--dsw-alias-bg-layer-1,#fff)}
.dmt-error-title{font-weight:600}
.dmt-error-body{color:var(--dsw-alias-label-secondary,#666);word-break:break-word}
.dmt-cmd{margin:0;padding:8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:var(--dsw-alias-label-primary,#111);font-family:var(--dsw-font-family-code,monospace);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all}
.dmt-btn{align-self:flex-start;font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2,#0000001f);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);cursor:pointer}
.dmt-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dmt-more{align-self:flex-start;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666);background:none;border:0;padding:2px 4px;cursor:pointer}
.dmt-tab{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff)}
.dmt-tab-main{display:flex;flex-direction:column;flex:1;min-height:0}
.dmt-tab-main .dmt-player{flex:1;min-height:0;border:0;border-radius:0;background:#000}
.dmt-tab-main video.dmt-media{flex:1;min-height:0;height:100%;max-height:none;object-fit:contain}
.dmt-tab-main audio.dmt-media{margin:auto 0}
.dmt-tab-main .dmt-head{background:var(--dsw-alias-bg-layer-1,#fff)}
.dmt-placeholder{padding:16px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#999)}
.dmt-loading{padding:24px 12px;font-size:12px;line-height:18px;text-align:center;color:var(--dsw-alias-label-tertiary,#999)}
video.dmt-media::-webkit-media-controls-fullscreen-button{display:none}
.dmt-player.dmt-theater{position:fixed;inset:0;z-index:2147483000;border:0;border-radius:0;background:#000;display:flex;flex-direction:column}
.dmt-theater .dmt-head{flex:none;background:#000}
.dmt-theater .dmt-name{color:#fff}
.dmt-theater .dmt-kind{color:#aaa}
.dmt-theater video.dmt-media{flex:1;min-height:0;width:100%;height:100%;max-height:none;object-fit:contain;background:#000}
.dmt-recent{border-top:.5px solid var(--dsw-alias-border-l2,#0000001f);flex:none;max-height:45%;display:flex;flex-direction:column;min-height:0}
.dmt-recent-head{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.dmt-recent-title{flex:1;min-width:0;font-weight:500}
.dmt-recent-list{list-style:none;margin:0;padding:0 0 4px;overflow:auto;min-height:0}
.dmt-recent-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;background:none;border:0;padding:6px 10px;cursor:pointer;min-width:0}
.dmt-recent-row:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dmt-recent-row[data-current=true]{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dmt-recent-row[disabled]{cursor:default;opacity:.55}
.dmt-recent-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dmt-recent-dot[data-kind=audio]{background:var(--dsw-alias-state-success-primary,#2ea043)}
.dmt-recent-body{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.dmt-recent-name{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary,#111);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-recent-sub{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-recent-missing{flex:none;font-size:11px;color:var(--dsw-alias-state-error-primary,#d54941)}
.dmt-recent-empty{padding:8px 10px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}
`

    function makeT(ctx) {
      const locale = ctx && ctx.locale
      let bound = null
      try {
        if (locale && typeof locale.bind === 'function') bound = locale.bind(NS)
      } catch {
        bound = null
      }
      return (key, fallback) => {
        if (bound) {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value && value !== key) return value
          } catch {
            /* fall through */
          }
        }
        return ZH[key] || fallback || key
      }
    }

    function isAbsPath(value) {
      return /^(\/|[A-Za-z]:[\\/])/.test(String(value || ''))
    }

    function baseName(file) {
      return String(file || '').split(/[\\/]/).pop() || String(file || '')
    }

    function dirName(file) {
      const parts = String(file || '').split(/[\\/]/)
      parts.pop()
      return parts.join('/') || '/'
    }

    function previewUrl(file) {
      return BASE + '/preview?p=' + encodeURIComponent(file)
    }

    const URL_CACHE = new Map()

    /**
     * The host signs an absolute media URL for this file. Absolute because the
     * desktop shell forwards dsh-app:// requests through Node fetch, which
     * drops Content-Length from every response; Chromium then treats the media
     * as an unbounded stream and refuses to seek.
     */
    function useSignedUrl(file, attempt) {
      const [state, setState] = useState(() => ({
        file,
        url: file ? (URL_CACHE.get(file) || '') : '',
        error: '',
      }))

      useEffect(() => {
        if (!file) {
          setState({ file, url: '', error: '' })
          return undefined
        }
        if (!attempt) {
          const cached = URL_CACHE.get(file)
          if (cached) {
            setState({ file, url: cached, error: '' })
            return undefined
          }
        }
        let cancelled = false
        fetch(BASE + '/api/sign?p=' + encodeURIComponent(file), { cache: 'no-store' })
          .then((response) => {
            if (response.ok) return response.json()
            throw Object.assign(new Error('sign failed'), { status: response.status })
          })
          .then((data) => {
            if (cancelled) return
            if (data && typeof data.url === 'string' && data.url) {
              URL_CACHE.set(file, data.url)
              setState({ file, url: data.url, error: '' })
            } else {
              setState({ file, url: '', error: 'noServer' })
            }
          })
          .catch((error) => {
            if (cancelled) return
            const status = error && error.status
            setState({
              file,
              url: '',
              error: status === 404 ? 'notFound' : status === 401 || status === 403 ? 'noAccess' : 'noServer',
            })
          })
        return () => { cancelled = true }
      }, [file, attempt])

      return state.file === file ? { url: state.url, error: state.error } : { url: '', error: '' }
    }

    /** dsh-resource://file/session/<sid>/<rel-or-/abs> → a plain path (best effort). */
    function pathFromAddress(address) {
      if (!address) return ''
      if (typeof address === 'object' && typeof address.path === 'string') return address.path
      const value = String(address)
      if (value.startsWith('file://')) {
        try {
          return decodeURIComponent(value.replace(/^file:\/\//, ''))
        } catch {
          return ''
        }
      }
      if (!value.startsWith('dsh-resource://file/')) return value
      try {
        const end = value.search(/[?#]/)
        const body = value.slice('dsh-resource://file/'.length, end === -1 ? undefined : end)
        const [scope, ...rest] = body.split('/')
        if (scope === 'session' && rest.length > 1 && rest[0]) {
          return rest.slice(1).map((part) => decodeURIComponent(part)).join('/')
        }
        if (scope === 'absolute' && rest.length && rest[0]) {
          return '/' + rest.map((part) => decodeURIComponent(part)).join('/')
        }
      } catch {
        return ''
      }
      return ''
    }

    function formatTime(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const secs = total % 60
      const pad = (value) => String(value).padStart(2, '0')
      return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
    }

    function relativeTime(timestamp, t) {
      const diff = Math.max(0, Date.now() - Number(timestamp || 0))
      if (diff < 60 * 1000) return t('justNow')
      if (diff < 60 * 60 * 1000) return t('minutesAgo').replace('{n}', String(Math.floor(diff / 60000)))
      if (diff < 24 * 60 * 60 * 1000) return t('hoursAgo').replace('{n}', String(Math.floor(diff / 3600000)))
      return t('daysAgo').replace('{n}', String(Math.floor(diff / 86400000)))
    }

    function extOf(file) {
      const match = /(\.[^./\\]+)$/.exec(String(file || ''))
      return match ? match[1].toLowerCase() : ''
    }

    function convertHint(file) {
      const extension = extOf(file)
      const stem = String(file).replace(/\.[^./\\]+$/, '')
      if (AUDIO_UNPLAYABLE.has(extension)) return `ffmpeg -i "${file}" -c:a aac "${stem}.m4a"`
      return `ffmpeg -i "${file}" -c:v libx264 -c:a aac -movflags +faststart "${stem}.mp4"`
    }

    function pauseOthers(element) {
      try {
        if (!element || typeof document === 'undefined') return
        document.querySelectorAll('video,audio').forEach((media) => {
          if (media !== element && !media.paused) media.pause()
        })
      } catch {
        /* ignore */
      }
    }

    function mediaErrorKey(error) {
      const code = error && error.target && error.target.error && error.target.error.code
      if (code === 2) return 'networkFailed'
      if (code === 3 || code === 4) return 'decodeFailed'
      return 'failed'
    }

    function ErrorCard({ reason, t, hint, onRetry }) {
      const [copied, setCopied] = useState(false)
      const copy = () => {
        try {
          navigator.clipboard.writeText(hint).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }, () => {})
        } catch {
          /* ignore */
        }
      }
      return h('div', { className: 'dmt-error' },
        h('div', { className: 'dmt-error-title' }, t('failed')),
        h('div', { className: 'dmt-error-body' }, t(reason)),
        hint ? h('pre', { className: 'dmt-cmd' }, hint) : null,
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          onRetry ? h('button', { className: 'dmt-btn', type: 'button', onClick: onRetry }, t('retry')) : null,
          hint ? h('button', { className: 'dmt-btn', type: 'button', onClick: copy }, copied ? t('copied') : t('copy')) : null,
        ),
      )
    }

    function MediaPlayer({ path: file, kind, name, mode, t, autoplay, loop, onReady, onFail, onOpenTab }) {
      const mediaRef = useRef(null)
      const durationRef = useRef(0)
      const recordedRef = useRef(false)
      const sentRef = useRef(0)
      const startedRef = useRef(false)
      const [duration, setDuration] = useState(0)
      const [error, setError] = useState(null)
      const [attempt, setAttempt] = useState(0)
      const [theater, setTheater] = useState(false)
      const theaterRef = useRef({ time: 0, playing: false })
      const signed = useSignedUrl(file, attempt)
      const src = signed.url

      const precheck = file && UNPLAYABLE_RE.test(file) ? 'unsupported' : null
      const shownError = error || precheck || signed.error

      const record = useCallback((event, position) => {
        if (!file) return
        try {
          fetch(BASE + '/api/recent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: file, event, position, duration: durationRef.current }),
            keepalive: true,
          }).then(() => {
            if (event === 'play' && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('dsh-media-tab:played', { detail: { path: file } }))
            }
          }).catch(() => {})
        } catch {
          /* recording is best-effort */
        }
      }, [file])

      useEffect(() => {
        recordedRef.current = false
        sentRef.current = 0
        startedRef.current = false
        durationRef.current = 0
        setDuration(0)
        setError(null)
      }, [file, attempt])

      useEffect(() => {
        if (!precheck) return
        setError(precheck)
        if (onFail) onFail()
      }, [precheck, onFail])

      useEffect(() => {
        if (signed.error && onFail) onFail()
      }, [signed.error, onFail])

      useEffect(() => {
        if (!theater) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          const media = mediaRef.current
          if (media) theaterRef.current = { time: media.currentTime, playing: !media.paused }
          setTheater(false)
        }
        document.addEventListener('keydown', onKey)
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          document.removeEventListener('keydown', onKey)
          document.body.style.overflow = previous
        }
      }, [theater])

      const toggleTheater = () => {
        const media = mediaRef.current
        if (media) theaterRef.current = { time: media.currentTime, playing: !media.paused }
        setTheater((value) => !value)
      }

      const diagnose = useCallback(() => {
        if (!file) return
        try {
          fetch(previewUrl(file), { method: 'HEAD', cache: 'no-store' }).then((response) => {
            if (response.status === 404) {
              setError('notFound')
              return
            }
            if (response.status === 401 || response.status === 403) {
              setError('noAccess')
              return
            }
            const type = String(response.headers.get('content-type') || '')
            if (!/^(video|audio)\//.test(type)) setError('noServer')
          }).catch(() => setError('noServer'))
        } catch {
          /* ignore */
        }
      }, [file])

      const handleLoadedMetadata = () => {
        const media = mediaRef.current
        if (!media) return
        if (media.duration === Infinity) {
          const settle = () => {
            media.removeEventListener('timeupdate', settle)
            try { media.currentTime = 0 } catch { /* ignore */ }
          }
          media.addEventListener('timeupdate', settle)
          try { media.currentTime = 1e101 } catch { /* ignore */ }
        }
        durationRef.current = Number.isFinite(media.duration) ? media.duration : 0
        setDuration(durationRef.current)
        const saved = theaterRef.current
        if (saved.time > 0) {
          try { media.currentTime = saved.time } catch { /* ignore */ }
        }
        theaterRef.current = { time: 0, playing: false }
        if (saved.playing) media.play().catch(() => {})
        if (!startedRef.current) {
          startedRef.current = true
          if (onReady) onReady()
        }
      }

      const handleError = () => {
        if (error) return
        const reason = mediaErrorKey({ target: mediaRef.current })
        setError(reason)
        if (onFail) onFail()
        diagnose()
      }

      const handlePlay = () => {
        const media = mediaRef.current
        pauseOthers(media)
        if (!recordedRef.current) {
          recordedRef.current = true
          record('play', media ? media.currentTime : 0)
        }
      }

      const handlePause = () => {
        const media = mediaRef.current
        if (mode === 'tab' && recordedRef.current && media) record('progress', media.currentTime)
      }

      const handleTimeUpdate = () => {
        if (mode !== 'tab' || !recordedRef.current) return
        const now = Date.now()
        if (now - sentRef.current < 5000) return
        sentRef.current = now
        const media = mediaRef.current
        if (media) record('progress', media.currentTime)
      }

      const mediaProps = {
        key: attempt,
        className: 'dmt-media',
        style: kind !== 'audio' && mode !== 'tab'
          ? { width: '100%', height: 'auto', maxHeight: '85vh', display: 'block', background: '#000' }
          : undefined,
        src,
        controls: true,
        controlsList: 'nofullscreen',
        playsInline: true,
        preload: 'metadata',
        autoPlay: !!autoplay,
        loop: !!loop,
        onLoadedMetadata: handleLoadedMetadata,
        onError: handleError,
        onPlay: handlePlay,
        onPause: handlePause,
        onTimeUpdate: handleTimeUpdate,
      }

      const player = h('div', {
        className: 'dmt-player' + (theater ? ' dmt-theater' : ''),
        'data-mode': mode || 'inline',
        'data-kind': kind,
      },
        h('div', { className: 'dmt-head' },
          h('span', { className: 'dmt-name', title: file || name }, name || baseName(file)),
          h('span', { className: 'dmt-kind' },
            `${kind === 'audio' ? t('audio') : t('video')}${duration ? ' · ' + formatTime(duration) : ''}`),
          kind !== 'audio' && src
            ? h('button', { className: 'dmt-action', type: 'button', onClick: toggleTheater }, theater ? t('exitFullscreen') : t('fullscreen'))
            : null,
          mode === 'inline' && onOpenTab
            ? h('button', { className: 'dmt-action', type: 'button', onClick: onOpenTab }, t('openInTab'))
            : null,
        ),
        shownError
          ? h(ErrorCard, {
              reason: shownError,
              t,
              hint: shownError === 'unsupported' ? convertHint(file || '') : '',
              onRetry: shownError === 'unsupported' ? undefined : () => setAttempt((value) => value + 1),
            })
          : !src
            ? h('div', { className: 'dmt-loading' }, t('preparing'))
            : h(kind === 'audio' ? 'audio' : 'video', Object.assign({ ref: mediaRef }, mediaProps)),
      )
      if (theater && ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined') {
        return ReactDOM.createPortal(player, document.body)
      }
      return player
    }

    function RecentList({ t, current, onPick }) {
      const [items, setItems] = useState(null)
      const [busy, setBusy] = useState(false)
      const [open, setOpen] = useState(false)

      const load = useCallback(() => {
        fetch(BASE + '/api/recent', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : { items: [] }))
          .then((data) => setItems(Array.isArray(data.items) ? data.items : []))
          .catch(() => setItems([]))
      }, [])

      useEffect(() => { load() }, [load])

      // A play or a new file changes the list; refresh shortly after the POST lands.
      useEffect(() => {
        const timer = setTimeout(load, 500)
        return () => clearTimeout(timer)
      }, [current, load])

      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onPlayed = () => {
          setTimeout(load, 600)
        }
        window.addEventListener('dsh-media-tab:played', onPlayed)
        return () => window.removeEventListener('dsh-media-tab:played', onPlayed)
      }, [load])

      const clear = () => {
        setBusy(true)
        fetch(BASE + '/api/recent/clear', { method: 'POST' })
          .then(() => setItems([]))
          .catch(() => {})
          .finally(() => setBusy(false))
      }

      const list = items || []
      const shown = open ? list : list.slice(0, 5)

      return h('div', { className: 'dmt-recent' },
        h('div', { className: 'dmt-recent-head' },
          h('span', { className: 'dmt-recent-title' }, `${t('recent')}${list.length ? ` (${list.length})` : ''}`),
          list.length > 5
            ? h('button', { className: 'dmt-action', type: 'button', onClick: () => setOpen((value) => !value) },
                open ? t('less') : t('more').replace('{n}', String(list.length - 5)))
            : null,
          list.length
            ? h('button', { className: 'dmt-action', type: 'button', disabled: busy, onClick: clear }, t('clear'))
            : null,
        ),
        items === null
          ? h('div', { className: 'dmt-recent-empty' }, t('preparing'))
          : list.length === 0
            ? h('div', { className: 'dmt-recent-empty' }, t('recentEmpty'))
            : h('ul', { className: 'dmt-recent-list' },
                shown.map((item) => h('li', { key: item.real || item.path },
                  h('button', {
                    className: 'dmt-recent-row',
                    type: 'button',
                    'data-kind': item.kind,
                    'data-current': item.real === current,
                    disabled: !!item.missing,
                    title: item.real || item.path,
                    onClick: () => onPick(item.real || item.path),
                  },
                    h('span', { className: 'dmt-recent-dot', 'data-kind': item.kind }),
                    h('span', { className: 'dmt-recent-body' },
                      h('span', { className: 'dmt-recent-name' }, item.title || baseName(item.real)),
                      h('span', { className: 'dmt-recent-sub' },
                        `${dirName(item.real || item.path)} · ${relativeTime(item.lastPlayedAt, t)}`),
                    ),
                    item.missing ? h('span', { className: 'dmt-recent-missing' }, t('missing')) : null,
                  ),
                )),
              ),
      )
    }

    function MediaTabBody(props) {
      const t = props.t || ((key, fallback) => fallback || key)
      const resource = typeof props.useResource === 'function' ? props.useResource(props.resourceAddress) : undefined
      const raw = pathFromAddress(props.resourceAddress)
      const hostPath = resource && resource.value && typeof resource.value.absolutePath === 'string'
        ? resource.value.absolutePath
        : ''
      const initial = hostPath || (isAbsPath(raw) ? raw : '')
      const [picked, setPicked] = useState(null)
      const file = picked || initial

      const content = props.content
      const version = resource && resource.value ? resource.value.version : undefined
      const onReady = useCallback(() => {
        if (content && content.kind === 'renderer' && typeof content.loaded === 'function') content.loaded(version)
      }, [content, version])
      const onFail = useCallback(() => {
        if (content && content.kind === 'renderer' && typeof content.failed === 'function') content.failed()
      }, [content])

      if (!file) {
        const status = resource && resource.status
        const key = status === 'loading' ? 'loading' : status === 'failed' ? 'readFailed' : 'noPath'
        return h('div', { className: 'dmt-placeholder' }, t(key))
      }

      return h('div', { className: 'dmt-tab' },
        h('div', { className: 'dmt-tab-main' },
          h(MediaPlayer, {
            path: file,
            kind: AUDIO_RE.test(file) ? 'audio' : 'video',
            name: baseName(file),
            mode: 'tab',
            t,
            onReady,
            onFail,
          }),
        ),
        h(RecentList, {
          t,
          current: file,
          onPick: (next) => setPicked(next),
        }),
      )
    }

    function readPresented(turn) {
      try {
        const data = turn && turn.data
        if (!data || typeof data.get !== 'function') return []
        const deliverables = data.get('deliverables')
        const presented = deliverables && Array.isArray(deliverables.presented) ? deliverables.presented : []
        return presented.filter((entry) => entry && typeof entry.path === 'string' && entry.path)
      } catch {
        return []
      }
    }

    function TurnTailPlayers(props) {
      const t = props.t || ((key, fallback) => fallback || key)
      const [expanded, setExpanded] = useState(false)

      const files = []
      const seen = new Set()
      for (const entry of readPresented(props.turn)) {
        if (!MEDIA_RE.test(entry.path)) continue
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        files.push(entry)
      }
      if (!files.length) return null

      const limit = 3
      const fold = !expanded && files.length > limit
      const shown = fold ? files.slice(0, limit) : files
      const rest = files.length - shown.length

      return h('div', { className: 'dmt-turn' },
        shown.map((entry) => h(MediaPlayer, {
          key: entry.path,
          path: entry.path,
          kind: AUDIO_RE.test(entry.path) ? 'audio' : 'video',
          name: entry.title || baseName(entry.path),
          mode: 'inline',
          t,
          autoplay: !!entry.autoplay,
          loop: !!entry.loop,
          onOpenTab: typeof props.openFile === 'function'
            ? () => {
                try {
                  const pending = props.openFile(entry.path)
                  if (pending && typeof pending.catch === 'function') pending.catch(() => {})
                } catch {
                  /* ignore */
                }
              }
            : undefined,
        })),
        fold && rest > 0
          ? h('button', { className: 'dmt-more', type: 'button', onClick: () => setExpanded(true) },
              t('more').replace('{n}', String(rest)), ' ▾')
          : expanded && files.length > limit
            ? h('button', { className: 'dmt-more', type: 'button', onClick: () => setExpanded(false) }, t('less'), ' ▴')
            : null,
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots) return
      ensureStyle()

      const t = makeT(ctx)

      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          const register = () => ctx.locale.register(NS, { zh: ZH, en: EN })
          if (typeof ctx.effect === 'function') ctx.effect(register, 'dsh-media-tab: locale')
          else register()
        }
      } catch (error) {
        console.warn('[dsh-media-tab] locale registration failed:', error)
      }

      try {
        if (ctx.documentPreviews && typeof ctx.documentPreviews.register === 'function') {
          const registerPreview = () => ctx.documentPreviews.register({
            id: NS,
            extensions: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv', '3gp',
              'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
            binaryExtensions: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv', '3gp',
              'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
            priority: 'extension',
            title: () => t('rendererTitle'),
            loading: 'renderer',
            wrap: false,
          })
          if (typeof ctx.effect === 'function') ctx.effect(registerPreview, 'dsh-media-tab: preview renderer')
          else registerPreview()
        }
      } catch (error) {
        console.warn('[dsh-media-tab] preview renderer registration failed:', error)
      }

      const registerTab = () => ctx.slots.register(
        { name: 'sidebar.right.tab.document', key: NS, locale: NS },
        (props) => h(MediaTabBody, { ...props, t }),
      )
      const registerTail = () => ctx.slots.register(
        { name: 'conversation.chat.turnTail', id: NS, locale: NS },
        (props) => h(TurnTailPlayers, { ...props, t }),
      )

      const safe = (label, fn) => () => {
        try {
          fn()
        } catch (error) {
          console.warn(`[dsh-media-tab] ${label} registration failed:`, error)
        }
      }

      try {
        if (typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('sidebar.right.tab.document', safe('document tab', registerTab))
          ctx.slots.inject('conversation.chat.turnTail', safe('turn tail', registerTail))
          return
        }
      } catch (error) {
        console.warn('[dsh-media-tab] slots.inject failed, registering directly:', error)
      }

      safe('document tab', registerTab)()
      safe('turn tail', registerTail)()
    }

    exports.apply = apply
    // Short client service names — package names here would never resolve.
    exports.inject = ['slots', 'locale', 'documentPreviews']
    return module.exports
  },
})
