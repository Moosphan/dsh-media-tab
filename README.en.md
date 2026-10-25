# dsh-media-tab

Play local video and audio inside DeepSeek Harness: inline under the reply, a dedicated sidebar player, and a recently-played list. Zero runtime dependencies, no ffmpeg.

[简体中文](README.md)

![Inline player](docs/inline-player.webp)

## Install

Requires DSH 0.2.x.

```sh
dsh plugin add github:Moosphan/dsh-media-tab
```

Restart DSH. The Plugins page then shows **Media Player**.

## Usage

- Media delivered with `present` gets a player under the reply automatically
- Say “play /path/a.mp4” and the model calls `play_media`
- Click a delivery card or **Open in sidebar** for the full-size player
- The player page ends with **Recently played**: the last 20 files, clearable

`play_media` parameters:

| Parameter | Required | Meaning |
|---|---|---|
| `path` | yes | Local path; `~` and session-relative paths are accepted |
| `title` | no | Player title, defaults to the file name |
| `autoplay` | no | Ask for autoplay |
| `loop` | no | Loop playback |

## Formats

| Kind | Formats |
|---|---|
| Video | `.mp4` `.m4v` `.mov` `.webm` `.ogv` `.mkv` `.3gp` |
| Audio | `.mp3` `.wav` `.ogg` `.oga` `.m4a` `.aac` `.flac` `.opus` `.weba` |
| Unsupported | `.avi` `.flv` `.wmv` `.wma` `.ts` `.mpg` `.rmvb` and similar; the player prints an `ffmpeg` command |

## Notes

- **Seeking on desktop**: the host signs an absolute media URL and the player loads directly from the local port, keeping Range and `Content-Length` intact.
- **Security**: only whitelisted media files are served, `realpath` blocks symlink escapes, UI routes require the login cookie, media routes require an HMAC signature, and nothing leaves the machine.
- **Data**: the recent list and signing secret live in `~/.dsh/cache/dsh-media-tab/`.
- Design details: [docs/architecture.md](docs/architecture.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Seeking does nothing | Quit DSH completely and reopen; the media request should be `http://127.0.0.1...` |
| “Cannot reach the playback service” | Restart DSH and check `/dsh-media-tab/api/health` returns `ok` |
| “Decode failed” | The codec is outside Chromium’s support; convert with the printed command |
| Black bars | The source aspect ratio is preserved; expected |

## License

[MIT](LICENSE)
