# Changelog

All notable changes to Agentage CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.4] - 2026-07-09

### Breaking

- Removed the standalone `agentage mcp` stdio command. MCP is now served by the local daemon over Streamable HTTP at `http://127.0.0.1:4243/mcp` (on by default; disable with `daemon start --no-mcp` or `AGENTAGE_DAEMON_NO_MCP=1`). Point clients at the daemon URL: `claude mcp add --transport http agentage http://127.0.0.1:4243/mcp`.

### New Features

- Account sync: the daemon syncs account (cloud) vaults, with live autodiscovery of new vaults and account-vault provisioning.
- `setup` now starts the daemon after a successful sign-in, so sync and MCP are ready immediately.
- `status` now reports the daemon (pid, port, uptime), MCP serving state, a `target` reachability check, and a per-vault breakdown (name, sync channel, status).
- Outgoing requests now identify the caller with `User-Agent` and CLI/daemon version headers.

### Improvements

- Auth: sessions refresh silently; a transient auth-server hiccup (429/5xx/network) is retried instead of being reported as a signed-out session.
- A credential for a different environment than the current target is now reported as an env mismatch (with a recovery hint), not a misleading "session expired".
- `status` auth line reads `signed in (session active)` rather than a raw UTC token-expiry timestamp.
- README rewritten for non-technical readers, with the full command and integration reference moved to `docs/reference.md`.
- Daemon hardened against CSRF and DNS rebinding on its local API; lifecycle and port-in-use races fixed.
- Sync: remote-URL allowlist and redaction; channel-based internal structure.
- Offline commands no longer hang; cleaner stdout/stderr discipline.

### Fixed

- Data integrity: concurrent writers can no longer silently drop registry updates. The advisory file lock now creates atomically (write-then-link) and never steals a live holder's lock under CPU contention.
- Packaging hygiene: dependency pins, trimmed npm tarball, removed tracked build artifacts.

### Internal

- `src/lib` and `src/commands` regrouped into domain folders; oversized modules split.

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
