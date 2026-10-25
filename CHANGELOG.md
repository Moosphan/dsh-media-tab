# Changelog

## 0.1.0

First release.

- Inline player under the reply for media delivered with `present`, plus the
  `play_media` tool for any local file.
- Right-sidebar player tab that takes over media files from the document
  preview, with HTTP Range streaming.
- Minimal recently-played list: newest first, 20 entries, missing files marked,
  clear action. Stored in `$DSH_HOME/cache/dsh-media-tab/recent.json`.
- Native `<video>`/`<audio>` controls; one player audible at a time; inline
  players fold after three files.
- Clear diagnostics for missing files, permission errors, unsupported codecs
  and an unreachable playback route.
- Zero runtime dependencies and no ffmpeg: unsupported containers get a
  copyable convert command instead of a black frame.
- Tests for Range/auth/fence, the recent store, the manifest and a stubbed
  client smoke; CI matrix on macOS, Ubuntu and Windows.
