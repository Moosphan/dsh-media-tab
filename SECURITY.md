# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1 | No |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's
private vulnerability reporting on this repository (Security → Report a
vulnerability), or email the maintainer listed in `package.json`.

Include:

- the affected version and DSH version
- the route or file involved (for example `/dsh-media-tab/media`)
- reproduction steps, and whether the request came from the DSH window, a normal
  browser, or another local process
- the impact you believe is possible

## Threat model

`dsh-media-tab` runs inside the DSH host and serves local media over the DSH web
server, which has no authentication of its own. The plugin therefore:

- serves **only** whitelisted media extensions, resolved through `realpath`, so
  symlinks cannot escape to other files
- requires a login-cookie check (DSH `connection` service) for the signing and
  recent-list APIs, with a loopback-only fallback when that service is absent
- requires an HMAC-signed capability URL for `/media`; the signature binds the
  absolute file path and the secret is stored at
  `$DSH_HOME/cache/dsh-media-tab/secret` with mode `0600`
- rejects cross-site requests and foreign `Origin`/`Host` headers on the
  cookie-gated routes
- streams with HTTP Range and never reads the whole file into memory
- makes no network requests and collects no telemetry

Out of scope:

- a local process that can already read the user's files
- a signed URL deliberately shared with a third party (it is a capability)
- codec or browser vulnerabilities in Chromium itself
- a compromised DSH installation or a malicious plugin running in the same host
