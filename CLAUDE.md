# CLAUDE.md - @agentage/cli

The `agentage` command (npm `@agentage/cli`). Core commands: `setup` (OAuth sign-in), `status`,
`update`, `daemon` and `extension`. Human docs are in [README.md](README.md); flags and exit
codes in [docs/reference.md](docs/reference.md); the extension author guide in
[docs/extensions.md](docs/extensions.md); profiles in [docs/profiles.md](docs/profiles.md). Do
not repeat them here.

## Commands

| Task                | Command                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Verify (every push) | `npm run verify` (type-check, e2e type-check, lint, format:check, test, build)                |
| Coverage (CI)       | `npm run test:coverage` (floors in `vitest.config.ts`)                                        |
| e2e, PR tier        | `npm run build && npm run test:e2e -- --grep @offline`                                        |
| e2e, live tier      | `npm run test:e2e -- --grep @smoke` (`AGENTAGE_SITE_FQDN` = target; CI: dispatch `e2e.yml`)   |
| Pack smoke          | `scripts/pack-smoke.sh`, `scripts/update-smoke.sh` (reads npm) on a packed tarball (`ci.yml`) |
| Mutation check      | `node scripts/mutate.mjs [ids]`; it edits `src`, so never run it beside verify                |
| Release             | dispatch `prepare-release.yml`; `release.yml` publishes on the merge (see README "Release")   |

## Where facts live

Each row names the doc first, then the code that proves it. Read the doc before `src/`.

- Install, sign-in, command list, config dir: `README.md`; `src/program.ts`, `src/lib/fs/config.ts`.
- `setup`, `status`, `update`: `docs/reference.md` sections of those names; `src/commands/auth/`,
  `status/`, `update/`, `extension/setup.ts`.
- The lifecycle (C1: install, list, update, disable, enable, configure, remove) and the move from
  0.51: `docs/reference.md` "Extension lifecycle"; `src/commands/extension/lifecycle*.ts`,
  `configure.ts`, `src/commands/daemon/installer.ts`, `move.ts`, `src/lib/daemon/host-client.ts`.
- The other `extension` subcommands (doctor, check, build, release, up, down, token):
  `docs/reference.md`; `src/commands/extension/` (`check` is in `build.ts`, `down` and `token`
  in `up.ts`), `src/lib/net/market.ts`.
- The daemon (`daemon start | status | stop | restart`, the port, `setup --no-daemon`):
  `docs/reference.md` "daemon"; `src/commands/daemon/`, `src/lib/daemon/`, the app host
  (`@agentage/apphost`).
- Extension commands and context, exit codes, environment, error codes: `docs/reference.md`;
  `src/commands/extension/delegate.ts`, `src/program.ts`, `src/lib/json-output.ts`.
- Profiles, states, the plan, short names, the profile file: `docs/profiles.md`;
  `src/core/installer/`, `src/core/loader/states.ts`.
- Writing an extension, `ctx`, peers, author commands, `extension create`, run it locally:
  `docs/extensions.md`; `src/extension.ts`, `src/core/loader/`, `src/commands/extension/create.ts`,
  `up.ts`.
- e2e scenarios: `e2e/core/README.md`. Test fixtures: `fixtures/README.md`.
- CI jobs and coverage floors (no doc): `.github/workflows/ci.yml`, `vitest.config.ts`.

## How the core works

- **The daemon** is the app host program (`@agentage/apphost`); the cli starts it and talks HTTP to
  it. Only `src/commands/daemon/run.ts` and `move.ts` import the app host, by dynamic import.
  `daemon.json` in the config dir names its pid, port and host token.
- **Lists:** `installation.json` (written by the daemon) is the one list of a machine. The
  lifecycle commands are clients of the daemon's `/host/extensions`; its installer
  (`commands/daemon/installer.ts`) puts one npm tree per `<id>@<version>` under
  `extensions/packages/trees/`. `core/loader/installed.ts` reads `installation.json` for the
  commands and `--help` without the daemon. `commands/daemon/move.ts` moves the 0.51 lists and
  settings into it once (D6).
- **The 0.51 tree** under `extensions/trees/` is read-only: nothing in `src` switches or deletes
  it. A version in it runs from there (`core/installer/old-tree.ts`); `src/test/old-install.ts`
  builds it for tests.
- **Profile** is the desired state. `setup` installs the account profile through the daemon once
  per machine (marker `setup.profile-installed`, with the failed ids, which a later setup tries
  again); `setup --profile` is never gated; `off` entries install disabled. Plain `setup` pulls
  the account profile and never pushes; on `404 PROFILE_NOT_FOUND` it creates it; after any other
  failure it uses the local `profile.json`, or installs nothing and prints one dim line. The plan
  (`setup --dry-run`, `setup --check`, the `status` count) says what it would change. No command
  pushes an install or remove to the account. `setup --latest` is the old name of
  `extension update`.
- **Two manifest kinds:**
  - The 1.0 API: `register(ctx)`, with `engines.agentage` over `EXTENSION_API_VERSION`.
  - Kit-shaped: `agentage.parts`, with `engines.agentage` over the kit's version. It is never
    loaded with `register`. The kit's `checkCli` checks it and its `runCommand` runs
    `agentage {command}` and `agentage {id} {command}`. Its exit code is the CLI's.
- **Verbs:** a verb that a core command, an extension id or an earlier install has stays
  namespaced. `commands.json`, written by cli 0.51, keeps who held each verb; nothing writes it now.
- **Account:** `setup`, `status` and `setup --disconnect` register the machine at `/v1/machines`
  (fire and forget, 2 s, never throwing). The profile lives at `/v1/profile` under one ETag.
- **Startup never imports the kit:** `src/core/kit-version.ts` reads its version from its
  `package.json`.
- **Child processes:** every process the cli starts gets the token-free env of
  `src/lib/child-env.ts`.
- **`kit-tool.ts`** is the one injected dependency over the kit's tool (`check`, `build`, `up`,
  `down`, `token`, `runCommand`, `checkCli`, `writeContracts`, ...). `extension up` builds into
  `dist.next/` and calls `POST /host/extensions/{id}/reload`; its record is `.agentage/up.json`.

## Rules the tests enforce

- `src/package-guard.test.ts`: no product or agent-runtime imports; the exact runtime dependency
  list (the core set, plus what the kit daemon and the kit's app build run on); no file in `src`
  imports `express`; the kit is 0.16.0 or newer.
- `src/lib/json-output.test.ts`: `CODES` in `src/lib/json-output.ts` equals the
  `<!-- codes -->` block of `docs/reference.md`, in order. A new error code changes both.
- `src/extension-test.test.ts`: the `ctx` members equal the list `docs/reference.md` documents.
- `src/core/` imports nothing product-shaped.

## Code shape

- `src/cli.ts` is the bin: the Node version guard, then a dynamic import of `program.ts`.
  Keep logic out of it (no coverage).
- `src/program.ts`: `createProgram(deps)` and `run(argv): Promise<number>` (the exit code, never
  `process.exit`); one `withAction` error path for every command.
- `src/commands/` is thin wiring; flow logic takes injected `Deps`. `src/test/` holds the unit
  kits (`config-dir.ts`, `npm-fixtures.ts`, `account.ts`), excluded from build and coverage.
- `src/extension.ts` and `src/extension-test.ts` are the subpath exports
  `@agentage/cli/extension` (type-only at runtime) and `@agentage/cli/extension/test`
  (`createTestContext`); the CLI never imports the second.

## Auth model

A fresh DCR public client per `setup` run (the redirect URI binds the ephemeral callback port);
`client_id` is stored in `auth.json` for the refresh grant. Tokens are opaque; `status` checks
them at the introspection endpoint (`/api/auth/mcp/get-session`). `status` shows no email or
plan: the account REST API takes session cookies only, not OAuth bearers. Every network call in
`lib/auth` goes through `cliFetch`; no bare `fetch`. `authedFetch` does one shared refresh per
process. `setup` stores `user: { id, email }` in `auth.json` from auth's extension exchange (the
answer a cloud app host's shell gets), so the daemon's shell shows the same label; the short token
in that answer is dropped. A session without `user` gets it at the next `setup`.

## E2E (`./e2e`, Playwright)

Drives the built `dist/cli.js` as a subprocess. Tiers are tags in the test titles:

- `@offline`: the PR tier (`e2e.yml`, required). Hermetic: loopback stubs only (`e2e/stub/` site,
  auth and account routes; `e2e/registry/` npm serving `fixtures/`). `@p0` is the hermetic
  `setup --no-browser` sign-in round trip, also `@offline`.
- `@smoke`: read-only against a live target; nothing signs in or writes.
- The agentage/e2e cli tier (`_e2e-cli.yml`, `--project=cli --grep @smoke`) runs on the packed
  cli: on every PR (`e2e.yml`, not required) and before each publish (`release.yml`, blocking).
  `scripts/candidate-registry.mjs` serves the tarball as npm `latest` on loopback. The tier reads
  prod, so a prod outage blocks a publish. A cli change that the tier pins (a help line, a renamed
  command) needs its agentage/e2e test first, version-gated on the release that changes it.

## Conventions

- `AGENTAGE_SITE_FQDN` selects the target host (production default); `AGENTAGE_CONFIG_DIR`
  overrides the config dir. e2e isolation depends on it: never remove it.
- Headless: `setup --no-browser` and `AGENTAGE_TOKEN=aga_...`; with the token, plain `setup`
  opens no browser. Install, list, run and remove of extensions need no sign-in.
- Exit codes: 0 ok (incl. `--help` and `--version`), 1 step failed, 2 usage, 3 only `daemon run`
  on a busy port, 129/130 `extension up` stopped by a signal (`docs/reference.md` "Exit
  codes"). Errors go to stderr.
- Publish only via `release.yml`, never a local `npm publish`.
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in code,
  docs, comments or commit messages.
