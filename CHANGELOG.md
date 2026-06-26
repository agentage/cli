# Changelog

All notable changes to Agentage CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.3] - 2026-06-27

### Fixed

- `status` now reaches the backend at the dedicated `api.<fqdn>` host (the apex `<fqdn>/api` was retired in the 2026-06-17 subdomain cutover), so production no longer reports the endpoint unreachable.
- `status` no longer crashes when the bearer maps to no active session (`get-session` returns `200 + null`); it now reports signed-out with a `run: agentage setup` hint.

## [0.0.2] - 2026-06-26

### New Features
- Add `setup` and `status` commands as part of the agentage Memory client reboot
- Add daemon autostart on boot/login (platform-aware configuration)
- Handle machine tombstoned state (410 response) gracefully in the daemon

### Improvements
- Route daemon version-mismatch notice and update notice to stderr for cleaner stdout output
- Reduce update-check cache from 24h to 1h for more timely update notifications

## [0.0.1] - 2026-06-12

### Added

- `setup` - browser OAuth 2.1 sign-in (Dynamic Client Registration + PKCE) with a
  localhost callback; tokens stored in `~/.agentage/auth.json` (mode 0600); flags:
  `--disconnect`, `--reauth`, `--no-browser`.
- `status` - one line per fact: CLI version, target, sign-in state, and endpoint
  reachability (`--json` supported).
