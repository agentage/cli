# CLAUDE.md - @agentage/cli

The agentage CLI launcher core. Commands: `setup` (OAuth sign-in), `status`, `update`. Plugins
extend it through `src/core/` (gated by `AGENTAGE_PLUGINS=1`).
memory, vault, daemon, sync and MCP code lives in git history up to v0.37.2 and returns as plugins.

## Layout
- `src/cli.ts` - the bin: Node version guard, then a dynamic import of `program.ts` (excluded
  from coverage; keep logic out of it)
- `src/program.ts` - `createProgram(deps)` factory + `run(argv): Promise<number>` (exit code,
  never `process.exit`); one `withAction` error path for every command, the update hint,
  `NO_COLOR`
- `src/commands/` - thin command wiring; flow logic takes injected `Deps` for testability:
  `auth/` (setup), `status/`, `update/`
- `src/lib/` - shared library, grouped by domain:
  - `auth/` - oauth (DCR + PKCE), callback-server (one-shot localhost), api (`authedFetch`:
    bearer + one shared refresh per process), introspect, sign-in (`ensureSignedIn`,
    `signIn`, `signOut`), credentials (PAT), env-match
  - `fs/` - config (`~/.agentage`, guarded 0600 auth.json), json-file (`readJson` with a type
    guard, `writeJsonAtomic`), file-lock (options: ttl, hard-stale, max wait)
  - `net/` - origins (one FQDN -> site, api, auth URLs), fetch (`cliFetch`: pinned fetch,
    timeout, CLI headers, no redirects), http (unref'd node:http/https GET), user-agent
  - `npm/` - npm-cli (`resolveNpmCli`, `runNpm` as `node npm-cli.js`, `requireNpm10`)
  - `status/` - status-info (the `status` report)
  - `update/` - update-check, update-cache
- `src/core/` - launcher core, gated by `AGENTAGE_PLUGINS=1`; imports nothing product-shaped (the
  package guard enforces it)
- `src/plugin.ts` - the `@agentage/cli/plugin` subpath export, versioned by `PLUGIN_API_VERSION`
- `fixtures/` - test-only plugin packages (`@agentage/fixture-*`), never published
- `e2e/registry/` - in-process npm registry serving `npm pack` output to e2e on loopback
- `scripts/bump-version.js` - release helper (`node scripts/bump-version.js patch|minor|major`)
- `src/package-guard.test.ts` - CI guard: no product or agent-runtime imports; runtime deps stay
  exactly `chalk + commander + open`

## Auth model
Fresh DCR public client per `setup` run (the redirect URI binds the ephemeral callback
port); `client_id` stored in auth.json for the refresh grant. Tokens are opaque; `status`
validates them via the OAuth introspection endpoint (`/api/auth/mcp/get-session`).
`status` omits account details (email/plan): the backend REST API accepts session cookies
only, not OAuth bearers.

## E2E (`./e2e`, Playwright)
Drives the built `dist/cli.js` as a subprocess. Tiers are tags in the test titles:
- `@offline` - the PR tier (`e2e.yml` on every PR): hermetic, no live stack, no secrets; the
  CLI talks only to loopback stubs (`e2e/stub/` site + auth server, `e2e/registry/` npm)
- `@p0` - the hermetic `setup --no-browser` sign-in round trip against the loopback stub
  (`e2e/stub/`, `AGENTAGE_SITE_FQDN=127.0.0.1:<port>`): DCR, PKCE authorize, code exchange,
  get-session, refresh rotation, revoke. The test plays "the browser" with a manual-redirect
  fetch; also tagged `@offline`, so it runs on every PR
- `@smoke` - the read-only live tier: version + degraded signed-out status against the
  target (`AGENTAGE_SITE_FQDN`, default `agentage.io`); nothing signs in or writes
Run via `npm run build && npm run test:e2e -- --grep @offline`; `@smoke` runs by manual dispatch
of `e2e.yml` with a target.

## Conventions
- `AGENTAGE_SITE_FQDN` selects the target host (production default); `AGENTAGE_CONFIG_DIR`
  overrides the config dir - e2e isolation depends on it, never remove
- `npm run verify` before any push; CI also runs `test:coverage` (thresholds 65/70/70/70)
- Exit codes: 0 ok (incl. `--help`/`--version`) / 1 step failed / 2 usage; errors on stderr
- Every network call in `lib/auth` goes through `cliFetch`; no bare `fetch`
- Conventional commits; publish only via the release workflow, never local `npm publish`
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in
  code, docs, comments, or commit messages
