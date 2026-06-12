# CLAUDE.md - @agentage/cli

Terminal client for agentage Memory. v0.25 reboot: `setup` (OAuth sign-in) + `status` only.
The pre-0.25 agent-runtime CLI (daemon, run/agents/machines/...) lives in git history only -
do not resurrect patterns from it.

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
Account details (email/plan/memories) in `status` are pending OAuth-bearer support in the
backend REST API - it currently accepts session cookies only.

## Conventions
- `AGENTAGE_SITE_FQDN` selects the target host (production default); `AGENTAGE_CONFIG_DIR`
  overrides the config dir - test isolation depends on it, never remove
- `npm run verify` before any push; CI also runs `test:coverage` (thresholds 65/70/70/70)
- Conventional commits; publish only via the release workflow, never local `npm publish`
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in
  code, docs, comments, or commit messages
