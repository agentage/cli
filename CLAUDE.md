# CLAUDE.md - @agentage/cli

The agentage CLI. Versioning RESTARTED at 0.0.x (old npm versions were
unpublished; earliest burned slot is 0.1.19 - stay below it until the line naturally
passes). Commands: `setup` (OAuth sign-in) + `status` only. The old
agent-runtime CLI (daemon, run/agents/machines/...) lives in git history only - do not
resurrect patterns from it.

## Layout
- `src/cli.ts` - commander entry (excluded from coverage; keep logic out of it)
- `src/commands/` - thin command wiring; flow logic takes injected `Deps` for testability
- `src/lib/` - origins (one FQDN -> service URLs), config (`~/.agentage`, 0600 auth.json),
  oauth (DCR + PKCE), callback-server (one-shot localhost), api (bearer + refresh-once),
  status-info
- `src/package-guard.test.ts` - CI guard: no daemon/agent-runtime remnants, runtime deps
  stay exactly `chalk + commander + open`

## Auth model
Fresh DCR public client per `setup` run (the redirect URI binds the ephemeral callback
port); `client_id` stored in auth.json for the refresh grant. Tokens are opaque; `status`
validates them via the OAuth introspection endpoint (`/api/auth/mcp/get-session`).
`status` omits account details (email/plan/memories): the backend REST API accepts
session cookies only, not OAuth bearers.

## E2E (`./e2e`, Playwright)
Drives the built `dist/cli.js` as a subprocess against a live stack (default dev target).
`@smoke` = version + degraded status; `@p0` = full headless OAuth round trip - the test
plays "the browser": signed-in session (Origin-stamped request context - the AS 403s
cookie POSTs without it) -> authorize 302 -> the CLI's localhost callback. Self-contained:
without `E2E_AUTH_*` env it signs up a throwaway account per run. Run via `npm run build
&& npm run test:e2e`; CI runs it in `e2e.yml` on every PR. Never point it at production.

## Conventions
- `AGENTAGE_SITE_FQDN` selects the target host (production default); `AGENTAGE_CONFIG_DIR`
  overrides the config dir - e2e isolation depends on it, never remove
- `npm run verify` before any push; CI also runs `test:coverage` (thresholds 65/70/70/70)
- Conventional commits; publish only via the release workflow, never local `npm publish`
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in
  code, docs, comments, or commit messages
