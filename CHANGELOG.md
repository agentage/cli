# Changelog

All notable changes to Agentage CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.1] - 2026-06-12

### Added

- `setup` - browser OAuth 2.1 sign-in (Dynamic Client Registration + PKCE) with a
  localhost callback; tokens stored in `~/.agentage/auth.json` (mode 0600); flags:
  `--disconnect`, `--reauth`, `--no-browser`.
- `status` - one line per fact: CLI version, target, sign-in state, and endpoint
  reachability (`--json` supported).
