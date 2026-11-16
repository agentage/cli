# CLAUDE.md - @agentage/cli

The agentage CLI core. Commands: `setup` (OAuth sign-in), `status`, `update`, `extension`. Human
docs are in [README.md](README.md); flags and exit codes in [docs/reference.md](docs/reference.md);
the extension author guide in [docs/extensions.md](docs/extensions.md); profiles in
[docs/profiles.md](docs/profiles.md). Do not repeat them here.

## Where facts live

- Install, sign-in, command list, config dir: `README.md` "Get started", "Commands", "Where things
  live"; `src/program.ts`, `src/lib/fs/config.ts`.
- `setup` (account profile, `--latest`, the plan), `status`, `update`: `docs/reference.md` sections
  of those names; `src/commands/auth/`, `status/`, `update/`, `extension/setup.ts`.
- The lifecycle (C1: install, list, update, disable, enable, configure, remove) and the move from
  0.51: `docs/reference.md` "Extension lifecycle"; `src/commands/extension/lifecycle*.ts`,
  `configure.ts`, `src/commands/daemon/installer.ts`, `move.ts`, `src/lib/daemon/host-client.ts`.
- The other `extension` subcommands (doctor, check, build, release, up/down/token):
  `docs/reference.md` section of that name; `src/commands/extension/` (`check` in `build.ts`,
  `down`/`token` in `up.ts`), `src/lib/net/market.ts`.
- The daemon (`daemon status | stop | restart`, the start, the port, `setup --no-daemon`):
  `docs/reference.md` "daemon"; `src/commands/daemon/`, `src/lib/daemon/`, the host in the kit
  (`@agentage/extension/host`).
- Extension commands and context, exit codes, environment: `docs/reference.md` headings of those
  names; `src/commands/extension/delegate.ts`, `src/program.ts`.
- Profiles, states, the plan, short names, updates, profile file: `docs/profiles.md`;
  `src/core/installer/`, `src/core/loader/states.ts`.
- Writing an extension, `ctx`, lifecycle, peers, author commands, run it locally, ports:
  `docs/extensions.md`; `src/extension.ts`, `src/core/loader/`, `src/commands/extension/up.ts`.
- CLI release: `README.md` "Release"; `.github/workflows/release.yml`, `prepare-release.yml`.
- e2e scenarios and tiers: `e2e/core/README.md`; `.github/workflows/e2e.yml`.
- CI jobs and coverage floors (no doc): `.github/workflows/ci.yml`, `vitest.config.ts`.

Each row names the doc first, then the code that proves it. Read the doc before `src/`.

## How the core works

- **Extensions** extend the CLI through `src/core/`, always on (no env switch).
- **Profile** is the desired state. The installed tree plus `state/<id>.json` is the current state.
  `setup` converges them. The plan (`setup --dry-run`, `setup --check`, the `status` count) says what it would change.
- **Commands:** `setup --profile` installs and loads a profile file. The lifecycle (C1:
  `extension install | list | update | disable | enable | configure | remove`) is a client of
  the daemon's `/host/extensions` (`lifecycle*.ts`, `configure.ts`, `lib/daemon/host-client.ts`);
  the daemon's installer is `commands/daemon/installer.ts`, one npm tree per `<id>@<version>`
  (`core/installer/package-dir.ts`). `installation.json` is the one list; `core/loader/installed.ts`
  reads it for the commands and `--help` without the daemon (a version in the 0.51 tree runs
  from there: `core/installer/old-tree.ts`), and `commands/daemon/move.ts` with `move-plan.ts`
  moves the 0.51 lists and settings into it once (D6). `status` and `doctor` read it once it
  exists (`scanNow`). `setup --latest` is the old name of `extension update`.
  `extension doctor` shows the profile rows.
  `extension check [dir]` is the kit's conformance check of a working copy.
- **Two manifest kinds:**
  - The 1.0 API: `register(ctx)`, with `engines.agentage` over `EXTENSION_API_VERSION`.
  - Kit-shaped: `agentage.parts`, with `engines.agentage` over the kit's version. It is never
    loaded with `register`. The kit's `checkCli` checks it and its `runCommand` runs
    `agentage {command}` and `agentage {id} {command}`. Its exit code is the CLI's.
- **Verbs:** a verb that a core command, an extension id or an earlier install has stays
  namespaced. `commands.json`, written by cli 0.51, keeps who held each verb; nothing writes it now.
- **Versions (profile path):** without a range, `setup` pins the newest release whose
  `engines.agentage` fits `EXTENSION_API_VERSION`. After a successful install only the tree that
  `extensions/current` names is kept.
- **Account sync** (signed in): the profile lives in the account at `/v1/profile`, under one ETag
  over profile, lock and npm major.
  - Plain `setup` pulls it and never pushes. On `404 PROFILE_NOT_FOUND` it creates it. After any
    other failure or 404 it uses the local `profile.json`, or installs nothing and prints one dim
    line. Plain `setup` installs the account profile through the daemon once per machine (marker
    `setup.profile-installed`, with the failed ids, which a later setup tries again); `setup --profile` is never gated; `off` entries install disabled
    (`setup-install.ts`, the plan of `--check`/`--dry-run` in `profile-plan.ts`). No command pushes an install or remove to the account.
  - `setup`, `status` and `setup --disconnect` register the machine at `/v1/machines` (fire and
    forget).
- Memory, vault, sync and MCP code lives in git history up to v0.37.2 and returns as
  extensions. The daemon is the kit's (`@agentage/extension/host`); the cli starts it and talks
  HTTP to it.

## Layout

- `src/cli.ts` - the bin: Node version guard, then a dynamic import of `program.ts` (excluded
  from coverage; keep logic out of it)
- `src/program.ts` - `createProgram(deps)` factory + `run(argv): Promise<number>` (exit code,
  never `process.exit`); one `withAction` error path for every command, the update hint,
  `NO_COLOR`
- `src/commands/` - thin command wiring. Flow logic takes injected `Deps` for testability.
  - `auth/`: `setup` registration, its flags and help. `status/`: `status`, with
    `account-status.ts` asking the account (seen, the profile's etag). `update/`: `update`.
  - `extension/` holds the rest. `rows.ts` gathers the extension rows; `list.ts` prints them and
    registers the `extension` group; `doctor.ts` loads once and reports; `row-lines.ts` renders
    the rows and the `status` lines.
  - One install path: the daemon's installer (`commands/daemon/installer.ts`, one tree per
    version under `extensions/packages/trees/`). The 0.51 tree under `extensions/trees/` is
    read-only: nothing in `src` switches or deletes it; `src/test/old-install.ts` builds it for
    tests.
  - `create.ts` is `extension create`: a shallow clone of the template, the other parts dropped,
    the word `template` rewritten to the id; `create-install.ts` then runs `npm ci`, the package
    build and `POST {source}` to the daemon (`--no-install` skips that), and prints the URL.
  - `install-once.ts`: the add is the check; the daemon's `CONFLICT` is "already installed"
    (`install` and the profile install of `setup` use it, so two runs cannot race).
  - `setup.ts` is the extensions `setup` flow; its only deps are the network ones, npm and the
    account. `setup-cloud.ts` is its signed-in half: account check, machine registration, pull or
    create, `--disconnect`. `plan.ts` is `setup --dry-run` and `setup --check`.
  - `sync.ts` holds the account check and the edit helpers the profile path still uses.
  - `account.ts` is the account dependency. `signedInAccount` does a bearer fetch to the API
    origin plus the account id from introspection, and gives null when signed out.
  - `configure.ts` is `extension configure`; a bare `--secret` key reads stdin or a hidden
    prompt (`readHidden`). `delegate.ts` registers one stub per contributed command and hands it to the
    extension.
  - `build.ts` is `extension check` (`--write` over the kit's `writeContracts`) and
    `extension build`: with no flag the package (`package-build.ts`: build script, contracts,
    check; no Docker), `--container` the kit's one image (only when the kit has it), `--push`
    the part images (`runImageBuild`, also used by `release`).
  - `kit-tool.ts` is that one injected dependency (`check`, `checkLines`, `build`, `buildLines`,
    `runCommand`, `checkCli`, `up`, `down`, `token`, `readManifest`, `writeContracts`, typed by the
    kit; `loadKitTool`, `kitCheck`, `kitVersion`, `kitBuildsContainer`).
  - `release.ts` is `extension release`: preflight, guard, `build --push`, the release asset, npm
    publish or stage. It sits over `release-guard.ts`, the guard and the bounded `execIn`
    injected dependency.
  - `up.ts` is `extension up`, `down` and `token` (registered in `up-commands.ts`, as the
    lifecycle commands are in `lifecycle-commands.ts`). Plain `up` is `up-run.ts`: the folder
    as a daemon row, a watch that builds into `dist.next/` (`up-build.ts` picks warm tsc or a
    staged `npm run build`, `up-watch.ts` runs them, `up-reload.ts` serialises the reloads) and
    `POST /host/extensions/{id}/reload`; its record is `.agentage/up.json` (`up-local.ts`, pids
    proven by start time in `src/lib/proc/start-time.ts`; `down` removes it, which stops the watch);
    `--docker` and the Docker part of `down` go to the kit. `stack-owner.ts` lets `token`
    ask only this folder's stack. `kit-commands.ts` registers a
    kit-built extension's `agentage {id}` group and top-level verbs; its `stub` is the one every
    delegated command uses.
- `src/commands/daemon/` - `daemon.ts`: `status`, `stop`, `restart` and the hidden `run`;
  `run.ts` is the daemon process (the kit's `createDaemon`, imported on use, until SIGTERM);
  `installer.ts` is its injected `Installer`: the market, then npm into one tree per version
  (`core/installer/package-dir.ts`)
- `src/lib/` - shared library, grouped by domain:
  - `daemon/` - the daemon client, HTTP only: `daemon-file.ts` (`daemon.json`, the port),
    `daemon-client.ts` (`ensureDaemon`: stale file, detached spawn, health wait),
    `daemon-stop.ts`, `host-client.ts` (the `/host/extensions` routes; the daemon's code as a
    `DaemonError`)
  - `json-output.ts` - the `--json` envelope, `CliError` and `CODES`, the one list of error codes
    (a test keeps it equal to `docs/reference.md`); `wait.ts` - `sleep` and the one poll loop;
    `child-env.ts` - the token-free env of every process the cli starts
  - `auth/` - oauth (DCR + PKCE), callback-server (one-shot localhost), api (`authedFetch`:
    bearer + one shared refresh per process), introspect, sign-in (`ensureSignedIn`,
    `signIn`, `signOut`), credentials (PAT), env-match
  - `fs/` - config (`~/.agentage`, guarded 0600 auth.json), json-file (`readJson` with a type
    guard, `writeJsonAtomic`), kit-lock (the kit daemon's own `<file>.lock` protocol, for a
    write beside the daemon: the D6 move), file-lock (`withFileLock` around sync or async work; options:
    ttl, hard-stale, max wait, onWait; `refreshFileLock` heartbeat)
  - `net/` - origins (one FQDN -> site, api, auth URLs; `apiOrigin` for the `/v1` routes), fetch (`cliFetch`: pinned fetch,
    timeout, CLI headers, no redirects), market and market-error (one code per way a site's
    market fails), http (unref'd node:http/https GET), user-agent
  - `npm/` - npm-cli (`resolveNpmCli`, `runNpm` as `node npm-cli.js`, `requireNpm10`)
  - `status/` - status-info (the `status` report)
  - `update/` - update-check, update-cache
- `src/core/` - the core; imports nothing product-shaped (the package guard enforces it)
  - `profile/` (schema v1 validator incl. `registries`, `profile.json` reader and writer plus
    the default profile, `machine.json` incl. dev paths, `accountId` and `profileEtag`,
    install/load set merge, `cloud.ts`: the
    `/v1/profile` wire (conditional GET, PUT with `If-Match` or `If-None-Match: *`; the `CloudFetch`
    injected dependency), `push.ts`: push with one replay on 412 and the npm-major lock rule (`lockCounts`: a new
    lock alone is a change, for `setup --latest`), `register.ts`: the
    `/v1/machines` calls, 2 s, never throwing, `AGENTAGE_DEBUG=1` prints one line each)
  - `kit-version.ts` - the kit's version read from its `package.json`, so startup never imports
    the kit
  - `loader/` - reading without running: `scan.ts` (profile + machine + manifests -> static states,
    the plan, rows to remove, integrity drift and the load set), `discover.ts`, `dev-path.ts` (a dev
    folder another user can write is invalid), `manifest.ts` (both kinds; `kit-manifest.ts` reads the kit-shaped block), `verbs.ts` (who
    runs each top-level verb: `claimVerbs`, `commands.json`), `config.ts` (config slice checked
    against `configuration`: type, `enum`, defaults filled), `states.ts`; running: `load.ts` (a
    session: peer order via `order.ts`, `AGENTAGE_TOKEN` removed, console to stderr,
    `state/<id>.json` via `state.ts`, which keeps `lastOk` for `ctx.previousVersion`), `register.ts`
    (`pathToFileURL` import + `register(ctx)` under a 10 s `timeout.ts`, then closes registration),
    `ctx.ts` (one revocable `ctx` per attempt, staged commands and subscriptions), `use.ts` (frozen
    facade), `dispose.ts` (5 s, SIGINT/SIGTERM), `secrets.ts` (`secrets.json` 0600), `log.ts`
    (`logs/<id>.log`)
  - `installer/` - `npm.ts` (`node npm-cli.js`, scrubbed env, `--registry` default; the `Npm` injected dependency
    for `ci`, `install` and `update`, the `NpmManifest` injected dependency for `pack` and `view`),
    `tree.ts` (deterministic `package.json` and per-scope `.npmrc`, a staged tree + `.complete`,
    `install.lock` with a heartbeat; used by `package-dir.ts` for the per-version trees), `compare-lock.ts` (normalized lock compare, root dependencies,
    locked versions, integrity drift), `compat.ts` (the gate: `engines.agentage` against
    `EXTENSION_API_VERSION`, or the kit's version for a kit-shaped release (`agentage.parts` in
    `npm view`), newest compatible version, `npm view` output),
    `plan.ts` (desired vs current: `add`, `update`, `remove`, `off`, `unchanged` per package, from
    the lock's root dependencies; lock drift), `resolve.ts` (what `extension install <name>`
    means: dev path, refused scheme, tarball URL, package or short name; a name without a range
    via `npm view <name>@>=0.0.0 name version engines` and the gate, anything else via
    `npm pack --dry-run`)
- `src/extension.ts` - the `@agentage/cli/extension` subpath export: the contract types
  (`ExtensionContext`, `ExtensionManifest`, `ExtensionApis` for a typed `use`, ...), identity
  `defineExtension`, versioned by `EXTENSION_API_VERSION`; type-only for extensions at runtime
- `src/extension-test.ts` - the `@agentage/cli/extension/test` subpath export:
  `createTestContext(overrides)`, a `mode: 'test'` ctx over a temp dir for extension authors'
  own unit tests; the CLI never imports it
- `src/test/config-dir.ts` - the unit-test kit for `src/core` and `src/commands/extension`: a
  fresh config dir per test (`dir.write`, `dir.profile`, `dir.tree`, `dir.extension` for a dev
  extension written from source) and `output()` capture; `src/test/npm-fixtures.ts` has
  `npmFromFixtures` playing npm installs and updates (`npmPublishing(more)` with versions a test
  publishes) and `manifestFromFixtures(more)` playing `npm pack --dry-run` and `npm view`;
  `src/test/account.ts` is an account in memory (`fakeAccount`: `/v1/profile` with ETags, 304, 404,
  412 and creation, `/v1/machines`, a request log, `fail` per route) for the `account` injected dependency;
  all excluded from the build and from coverage
- `docs/extensions.md` - "Writing an extension": the author guide (manifest, lifecycle, `ctx`);
  keep it true to `src/extension.ts` and `src/core/loader/`
- `fixtures/` - test-only extension packages (`@agentage/fixture-*`), never published
- `e2e/registry/` - in-process npm registry serving `npm pack` output to e2e on loopback
- `scripts/bump-version.js` - release helper (`node scripts/bump-version.js patch|minor|major`)
- `scripts/pack-smoke.sh`, `scripts/update-smoke.sh` - the `Pack smoke` CI job: the packed cli with
  only its declared dependencies (bin, daemon `/health`, express, PGlite), and a 0.51.1 user's
  update over its own state (D6, reads npm); both run locally on a tarball
- `scripts/mutate.mjs` - the mutation check of the rule tests (`node scripts/mutate.mjs [ids]`):
  each mutation must turn its tests red; it edits `src`, so never run it beside verify
- `src/package-guard.test.ts` - CI guard: no product or agent-runtime imports; runtime deps stay
  exactly `@agentage/extension + chalk + commander + open` (the kit's tool only; it never loads
  the kit's server stack outside the daemon process) plus `express` and `@electric-sql/pglite`,
  which the kit daemon runs on; only `src/commands/daemon/run.ts` and `src/commands/extension/up-run.ts`
  load `@agentage/extension/host`; no file in `src` imports `express`

## Auth model

Fresh DCR public client per `setup` run (the redirect URI binds the ephemeral callback
port); `client_id` stored in auth.json for the refresh grant. Tokens are opaque; `status`
validates them via the OAuth introspection endpoint (`/api/auth/mcp/get-session`).
`status` omits account details (email/plan): the backend REST API accepts session cookies
only, not OAuth bearers.

## E2E (`./e2e`, Playwright)

Drives the built `dist/cli.js` as a subprocess. Tiers are tags in the test titles:

- `@offline` - the PR tier (`e2e.yml` on every PR): hermetic, no live stack, no secrets; the
  CLI talks only to loopback stubs (`e2e/stub/` site + auth server + the account routes
  `/v1/profile` and `/v1/machines`, `e2e/registry/` npm)
- `@p0` - the hermetic `setup --no-browser` sign-in round trip against the loopback stub
  (`e2e/stub/`, `AGENTAGE_SITE_FQDN=127.0.0.1:<port>`): DCR, PKCE authorize, code exchange,
  get-session, refresh rotation, revoke. The test plays "the browser" with a manual-redirect
  fetch; also tagged `@offline`, so it runs on every PR
- `@smoke` - the read-only live tier: version + degraded signed-out status against the
  target (`AGENTAGE_SITE_FQDN`, default `agentage.io`); nothing signs in or writes
  `e2e/core/` holds the extension scenarios, one requirement per test, on the `cli` kit in
  `e2e/core/cli.ts` (see `e2e/core/README.md`).
  Run via `npm run build && npm run test:e2e -- --grep @offline`; `@smoke` runs by manual dispatch
  of `e2e.yml` with a target.
  Before a publish, `release.yml` runs agentage/e2e's cli tier against this commit through
  `_e2e-cli.yml`. The tier is `--project=cli --grep @smoke`, what verify-prod runs on the published
  cli. `scripts/candidate-registry.mjs` serves the packed tarball as npm `latest` on loopback and
  proxies the rest. A red tier blocks the publish: fix, then dispatch `release.yml`. The tier reads
  prod agentage.io, so a prod outage blocks it too.
  `e2e.yml` runs the same tier on every PR, not required. A cli change the e2e tier pins (a help
  line, a renamed command) needs its agentage/e2e test first, version-gated on the release that
  changes it. Its PR is red until then.

## Conventions

- `AGENTAGE_SITE_FQDN` selects the target host (production default); `AGENTAGE_CONFIG_DIR`
  overrides the config dir - e2e isolation depends on it, never remove
- `npm run verify` before any push; CI also runs `test:coverage` (global 65/70/70/70, `src/lib/**`
  and `src/core/**` have higher floors in `vitest.config.ts`)
- Headless: `setup --no-browser` (`src/commands/auth/setup.ts`) and `AGENTAGE_TOKEN=aga_...`
  (`src/lib/auth/credentials.ts`); with the token, plain `setup` opens no browser sign-in. Install, list, run and
  remove of extensions need no sign-in.
- Exit codes: 0 ok (incl. `--help`/`--version`) / 1 step failed / 2 usage; errors on stderr
- Every network call in `lib/auth` goes through `cliFetch`; no bare `fetch`
- Conventional commits; publish only via the release workflow, never local `npm publish`
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in
  code, docs, comments, or commit messages
