# CLAUDE.md - @agentage/cli

The agentage CLI core. Commands: `setup` (OAuth sign-in), `status`, `update`, `extension`. Human
docs are in [README.md](README.md); flags and exit codes in [docs/reference.md](docs/reference.md);
the extension author guide in [docs/extensions.md](docs/extensions.md); profiles in
[docs/profiles.md](docs/profiles.md). Do not repeat them here.

## Where facts live

- Flags, exit codes, environment variables per command: `docs/reference.md` (one section per
  command, "Exit codes", "Environment").
- Install, sign-in, the command list, the config dir layout: `README.md` "Get started",
  "Commands", "Where things live".
- Writing an extension, `ctx`, lifecycle, kit-built packages: `docs/extensions.md`.
- Create, up and token of a kit-built extension, its ports: `docs/extensions.md` "Run it locally"
  (summary in `README.md` "Write and run your own extension"); flags in `docs/reference.md`
  "extension up, down and token".
- Profiles, extension states, the plan, short names, `setup --latest`: `docs/profiles.md`.
- CI jobs and coverage floors: `.github/workflows/ci.yml`, `vitest.config.ts`.
- Release and publish rules: `.github/workflows/release.yml`,
  `.github/workflows/prepare-release.yml`.
- e2e scenarios and tiers: `e2e/core/README.md`, `.github/workflows/e2e.yml`.

Read the file named here before you read `src/`.

## How the core works

- **Extensions** extend the CLI through `src/core/`, always on (no env switch).
- **Profile** is the desired state. The installed tree plus `state/<id>.json` is the current state.
  `setup` converges them. The plan (`setup --dry-run`, `setup --check`, the `extension list` drift
  column, the `status` count) says what it would change.
- **Commands:** `setup --profile` installs and loads a profile file. `setup --latest` runs
  `npm update` in a staged tree and makes the new tree current only after a clean load.
  `extension install` and `remove` change one extension. `extension list` and `doctor` show them.
  `extension check [dir]` is the kit's conformance check of a working copy.
- **Two manifest kinds:**
  - The 1.0 API: `register(ctx)`, with `engines.agentage` over `EXTENSION_API_VERSION`.
  - Kit-shaped: `agentage.parts`, with `engines.agentage` over the kit's version. It is never
    loaded with `register`. The kit's `checkCli` checks it and its `runCommand` runs
    `agentage {command}` and `agentage {id} {command}`. Its exit code is the CLI's.
- **Verbs:** a verb that a core command, an extension id or an earlier install has stays
  namespaced. `commands.json` keeps who holds each verb.
- **Versions:** without a range, `extension install` pins the newest release whose
  `engines.agentage` fits `EXTENSION_API_VERSION`. After a successful install only the tree that
  `extensions/current` names is kept.
- **Account sync** (signed in): the profile lives in the account at `/v1/profile`, under one ETag
  over profile, lock and npm major.
  - Plain `setup` pulls it and never pushes. On `404 PROFILE_NOT_FOUND` it creates it. After any
    other failure or 404 it uses the local `profile.json`, or installs nothing and prints one dim
    line.
  - `extension install`, `remove`, `--off` and `setup --latest` push after the new tree loaded,
    and replay once on a 412.
  - `setup`, `status` and `setup --disconnect` register the machine at `/v1/machines` (fire and
    forget).
- Memory, vault, daemon, sync and MCP code lives in git history up to v0.37.2 and returns as
  extensions.

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
  - `install-load.ts` is the flow `setup`, `install` and `remove` end with: install, load, print
    rows, fail. `install.ts` adds one extension; npm is its only injected dependency, and a
    kit-built working copy prints `linked`. `remove.ts` takes one out; `--purge` asks through an
    injected `isTTY`/`prompt`.
  - `create.ts` is `extension create`: a shallow clone of the template, the other parts dropped,
    the word `template` rewritten to the id.
  - `setup.ts` is the extensions `setup` flow; its only deps are the network ones, npm and the
    account. `setup-cloud.ts` is its signed-in half: account check, machine registration, pull or
    create, `--disconnect`. `plan.ts` is `setup --dry-run` and `setup --check`.
  - `sync.ts` is the edit path of `install`, `remove` and `--off`: pull whole, change, install,
    load, push with one replay. `latest.ts` is `setup --latest`: the diff and summary, the new
    tree loaded before it becomes current, then the same push with the lock counting.
  - `account.ts` is the account dependency. `signedInAccount` does a bearer fetch to the API
    origin plus the account id from introspection, and gives null when signed out.
  - `secrets-prompt.ts` asks for or lists missing secrets; `isTTY`/`prompt` are its only injected
    dependencies. `delegate.ts` registers one stub per contributed command and hands it to the
    extension.
  - `build.ts` is `extension check` (`--write` over the kit's `writeContracts`) and
    `extension build`. Both are thin commands over the kit's `@agentage/extension/tool`, imported
    on use.
  - `kit-tool.ts` is that one injected dependency (`check`, `checkLines`, `build`, `buildLines`,
    `runCommand`, `checkCli`, `up`, `down`, `token`, `readManifest`, typed by the kit; `loadKitTool`,
    `kitCheck`).
  - `release.ts` is `extension release`: preflight, guard, `build --push`, the release asset, npm
    publish or stage. It sits over `release-guard.ts`, the guard and the bounded `execIn`
    injected dependency.
  - `up.ts` is `extension up`, `down` and `token` over the kit; `stack-owner.ts` lets `token`
    ask only this folder's stack. `kit-commands.ts` registers a
    kit-built extension's `agentage {id}` group and top-level verbs; its `stub` is the one every
    delegated command uses.
- `src/lib/` - shared library, grouped by domain:
  - `auth/` - oauth (DCR + PKCE), callback-server (one-shot localhost), api (`authedFetch`:
    bearer + one shared refresh per process), introspect, sign-in (`ensureSignedIn`,
    `signIn`, `signOut`), credentials (PAT), env-match
  - `fs/` - config (`~/.agentage`, guarded 0600 auth.json), json-file (`readJson` with a type
    guard, `writeJsonAtomic`), file-lock (`withFileLock` around sync or async work; options:
    ttl, hard-stale, max wait, onWait; `refreshFileLock` heartbeat)
  - `net/` - origins (one FQDN -> site, api, auth URLs; `apiOrigin` for the `/v1` routes), fetch (`cliFetch`: pinned fetch,
    timeout, CLI headers, no redirects), http (unref'd node:http/https GET), user-agent
  - `npm/` - npm-cli (`resolveNpmCli`, `runNpm` as `node npm-cli.js`, `requireNpm10`)
  - `status/` - status-info (the `status` report)
  - `update/` - update-check, update-cache
- `src/core/` - the core; imports nothing product-shaped (the package guard enforces it)
  - `profile/` (schema v1 validator incl. `registries`, `profile.json` reader and writer plus
    the default profile, `machine.json` incl. dev paths, `accountId` and `profileEtag`,
    install/load set merge, `edit.ts`: one extension in or out of the profile, `cloud.ts`: the
    `/v1/profile` wire (conditional GET, PUT with `If-Match` or `If-None-Match: *`; the `CloudFetch`
    injected dependency), `push.ts`: push with one replay on 412 and the npm-major lock rule (`lockCounts`: a new
    lock alone is a change, for `setup --latest`), `register.ts`: the
    `/v1/machines` calls, 2 s, never throwing, `AGENTAGE_DEBUG=1` prints one line each)
  - `kit-version.ts` - the kit's version read from its `package.json`, so startup never imports
    the kit
  - `loader/` - reading without running: `scan.ts` (profile + machine + manifests -> static states,
    the plan, rows to remove, integrity drift and the load set; or of a tree that is not current
    yet, for `setup --latest`), `discover.ts`, `dev-path.ts` (a dev
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
    `tree.ts` (deterministic `package.json` and per-scope `.npmrc`, staged
    `extensions/trees/<hash>/` + `.complete` + `extensions/current`, `install.lock` with a
    heartbeat, `collectTrees`: every tree but `current` removed after a success, staging dirs left
    to the next locked run), `compare-lock.ts` (normalized lock compare, root dependencies,
    locked versions, integrity drift), `compat.ts` (the gate: `engines.agentage` against
    `EXTENSION_API_VERSION`, or the kit's version for a kit-shaped release (`agentage.parts` in
    `npm view`), newest compatible version, `npm view` output),
    `latest.ts` (`setup --latest`: `npm update` in a staged tree, held-back extensions whose new
    version fails the gate, the version diff, a check before the tree becomes current),
    `plan.ts` (desired vs current: `add`, `update`, `remove`, `off`, `unchanged` per package, from
    the lock's root dependencies; lock drift), `installer.ts` (install plan, install, refuses
    integrity drift; npm is the only injected dep), `resolve.ts` (what `extension install <name>`
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
  412 and creation, `/v1/machines`, a request log, `fail` per route) for the `account` injected dependency; all
  excluded from the build and from coverage
- `docs/extensions.md` - "Writing an extension": the author guide (manifest, lifecycle, `ctx`);
  keep it true to `src/extension.ts` and `src/core/loader/`
- `fixtures/` - test-only extension packages (`@agentage/fixture-*`), never published
- `e2e/registry/` - in-process npm registry serving `npm pack` output to e2e on loopback
- `scripts/bump-version.js` - release helper (`node scripts/bump-version.js patch|minor|major`)
- `src/package-guard.test.ts` - CI guard: no product or agent-runtime imports; runtime deps stay
  exactly `@agentage/extension + chalk + commander + open` (the kit's tool only; it never loads
  the kit's server stack, and `express` is an optional peer the cli does not install)

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
  (`src/lib/auth/credentials.ts`); plain `setup` ignores the token. Install, list, run and
  remove of extensions need no sign-in.
- Exit codes: 0 ok (incl. `--help`/`--version`) / 1 step failed / 2 usage; errors on stderr
- Every network call in `lib/auth` goes through `cliFetch`; no bare `fetch`
- Conventional commits; publish only via the release workflow, never local `npm publish`
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in
  code, docs, comments, or commit messages
