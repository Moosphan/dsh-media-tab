# Contributing

## Development

```sh
npm test          # node --test: 39 cases
npm pack --dry-run
```

Tests cover Range (200/206/416/HEAD), signing and authorization failures, the cross-site fence, `/api/sign`, recent-store LRU/dedupe/corruption/concurrency, manifest consistency and a client component smoke render.

The browser half is a plain `window.__ModuleLoader__.load` bundle; there is no build step.

## Rules

- Keep **zero runtime dependencies**; do not import `@deepseek-ai/*` at runtime.
- Keep media reads local: no outbound requests, no telemetry.
- Run `npm test` before opening a PR.
- For a new format or behaviour, open an issue first so the scope is agreed.

## Release

1. `npm test`
2. Run the manual QA in [docs/architecture.md](docs/architecture.md#manual-qa) on a real DSH
3. `npm publish --access public`
4. Create a GitHub release with the `npm pack` artifact
5. Update `CHANGELOG.md`

## Bug reports

Include:

- DSH version and plugin version
- operating system
- reproduction steps
- any `[dsh-media-tab]` lines from the DevTools console
- the media request URL and status from the Network panel when playback is involved

## Security

Do not open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
