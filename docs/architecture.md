# Architecture

## Mount points

| Surface | DSH mount point | Data |
|---|---|---|
| Under the reply | `conversation.chat.turnTail` | `turn.data.get('deliverables').presented` |
| Sidebar player | `documentPreviews` renderer + `sidebar.right.tab.document` | File address (delivery card / file link / recent list) |
| Tool link | `play_media` result | Signed absolute URL |

`play_media` and `present` both append the official `deliverables/presented` event, so the inline player, the delivery card and the sidebar all point at the same file.

## Request flow

```text
present / play_media
        │
        └─ deliverables/presented ──► turnTail ──┐
                                                  │
delivery card / file link ──► documentPreviews ───┼──► MediaPlayer
                                                  │        │
recently played ──────────────────────────────────┘        │ GET /api/sign (login cookie)
                                                           ▼
                                              absolute + HMAC-signed URL
                                                           │ <video src>
                                                           ▼
                                     /dsh-media-tab/media?t=…  ── Range ──► disk
```

## Routes

| Route | Authorization | Purpose |
|---|---|---|
| `GET /dsh-media-tab/api/health` | Host fence | Readiness probe |
| `GET /dsh-media-tab/api/sign?p=` | Login cookie + fence | Mint the absolute signed URL |
| `GET/HEAD /dsh-media-tab/media?p=&t=` | **HMAC signature** | Range streaming |
| `GET/HEAD /dsh-media-tab/preview?p=` | Login cookie + fence | Diagnostics / compatibility |
| `GET/POST /dsh-media-tab/api/recent` | Login cookie + fence | Read / record the recent list |
| `POST /dsh-media-tab/api/recent/clear` | Login cookie + fence | Clear the recent list |

The whole plugin registers one prefix route on `ctx.webServer` and dispatches these paths itself.

## Why media URLs are absolute

The desktop page loads from `dsh-app://app`; ordinary requests are forwarded to the local HTTP server by Electron. `forwardWebRequest` removes `Content-Length` from every response, so a 206 response has no length, Chromium treats the media as an unbounded stream, and seeking is disabled — the progress bar does nothing and paused scrubbing does not update the frame.

The player therefore asks `/api/sign` for an **absolute** URL and loads `<video>` straight from `http://127.0.0.1:<port>`, preserving `Content-Length` / `Content-Range`. The signed URL is cached per file for the lifetime of the page.

Because the desktop window reaches that URL from a `dsh-app://` origin, media responses carry `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`. The HMAC token is the capability; without it no bytes are served.

## Security model

- **Media only**: extension whitelist; symlinks are resolved with `realpath`; directories, text files and arbitrary paths return 403.
- **Fence**: Host must be loopback or DSH's own host; `Sec-Fetch-Site: cross-site` is rejected; a present `Origin` must match the Host.
- **Two authorization paths**:
  - `/preview`, `/api/sign`, `/api/recent*` go through DSH's `connection` service (login cookie); older hosts without it are loopback-only.
  - `/media` accepts only an HMAC-SHA256 signature (32 hex chars). The secret lives at `$DSH_HOME/cache/dsh-media-tab/secret` with mode `0600`.
- **Streaming**: `fs.createReadStream` reads only the requested range. A disk error ends that response; it never crashes the host.
- **No network, no telemetry, no directory scanning.**

## Data

| Item | Location |
|---|---|
| Recently played | `$DSH_HOME/cache/dsh-media-tab/recent.json` |
| Signing secret | `$DSH_HOME/cache/dsh-media-tab/secret` |

`DSH_HOME` defaults to `~/.dsh`. Recent entries look like:

```json
{
  "v": 1,
  "items": [
    {
      "path": "/Users/me/Movies/demo.mp4",
      "title": "demo.mp4",
      "kind": "video",
      "size": 29312618,
      "duration": 60.4,
      "position": 12.3,
      "plays": 2,
      "lastPlayedAt": 1761000000000
    }
  ]
}
```

Writes are atomic (temp file + rename). Corrupt JSON is renamed aside instead of being retried forever. The store keeps at most 20 entries and de-duplicates by real path.

## Package layout

| File | Responsibility |
|---|---|
| `lib/index.js` | Host: route registration, `play_media`, `deliverables/presented` bridge |
| `lib/server.js` | Range, HMAC, authorization, fence, signing API, streaming |
| `lib/recent.js` | Recent store: atomic writes, LRU, dedupe, missing-file marking |
| `lib/client.js` | Browser half: inline player, sidebar page, recent list, signed-URL cache |
| `cordis.patch.yml` | Bundle mount declaration |

## Manual QA

1. `link:` install, restart, confirm the **Media Player** card
2. `present` an mp4 → player under the reply, full width, seeking works
3. Open the delivery card → sidebar player
4. Play it → the recent list shows the file; click to switch
5. Play an `.avi` → error card with the `ffmpeg` command
6. Pause, then scrub → the frame follows
7. DevTools → Network: media request is `206 Partial Content` at `http://127.0.0.1:<port>/dsh-media-tab/media...`

## Known limitations

- No transcoding, playlists, HLS (`.m3u8`) or remote URLs
- No subtitle tracks, audio artwork or waveform
- The recent list is fixed at 20 entries; no favourites, search or tags
- Recent entries switch inside the current player page instead of opening a new tab
- Host changes require a DSH restart; client changes only need a page refresh
- One player is audible at a time
