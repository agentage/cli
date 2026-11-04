# CLAUDE.md - @agentage/cli

The agentage CLI core. Commands: `setup` (OAuth sign-in), `status`, `update`.
Extensions extend it through `src/core/`, always on (no env switch): `setup --profile` installs
and loads them, `setup --latest` moves them to the newest versions their ranges allow (`npm update`
in a staged tree, the new tree current only after a clean load), `extension install` and
`extension remove` add or take out one at a time, `extension list` and `extension doctor` show
them (`extension check` is its old name for 90 days), and the commands they contribute run
as `agentage <command>`. Two manifest kinds: the 1.0 API (`register(ctx)`, `engines.agentage`
over `EXTENSION_API_VERSION`) and kit-shaped (`agentage.parts`; `engines.agentage` over the kit's
version; never register-loaded: the kit's `checkCli` checks it, its `runCommand` runs
`agentage {command}` and `agentage {id} {command}`, its exit code is the CLI's; a verb a core
command, an extension id or an earlier install has stays namespaced, `commands.json` keeps who
holds each verb). Without a range, `extension
install` pins the newest release whose `engines.agentage` fits `EXTENSION_API_VERSION`. After a
successful install only the tree `extensions/current` names is kept. The model: the profile is the
desired state, the installed tree (plus
`state/<id>.json`) the current one; `setup` converges them, the plan (`setup --dry-run`,
`setup --check`, the `extension list` drift column, the `status` count) says what it would change.
Signed in, the profile lives in the account (`/v1/profile`, one ETag over profile, lock and npm
major): plain `setup` pulls it (creating it on a `404 PROFILE_NOT_FOUND`; any other failure, or
any other 404, uses the local profile.json, or installs nothing and says so on one dim line when
there is none) and never pushes; `extension install`, `remove`, `--off` and `setup --latest` push
after the new tree loaded, replaying once on a 412; `setup`, `status` and
`setup --disconnect` register the machine at `/v1/machines` (fire and forget).
memory, vault, daemon, sync and MCP code lives in git history up to v0.37.2 and returns as
extensions.

## Layout
- `src/cli.ts` - the bin: Node version guard, then a dynamic import of `program.ts` (excluded
  from coverage; keep logic out of it)
- `src/program.ts` - `createProgram(deps)` factory + `run(argv): Promise<number>` (exit code,
  never `process.exit`); one `withAction` error path for every command, the update hint,
  `NO_COLOR`
- `src/commands/` - thin command wiring; flow logic takes injected `Deps` for testability: `auth/`
  (`setup` registration: its flags and help), `status/`, `update/`, `extension/` (`rows.ts` gathers the extension rows, `list.ts`
  prints them and registers the `extension` group, `doctor.ts` loads once and reports (and
  `deprecatedCheck`, the `check` alias), `row-lines.ts`
  renders the rows and the `status` lines, `install-load.ts` is the install, load, print rows, fail
  flow `setup`, `install` and `remove` end with, `setup.ts` is the extensions `setup` flow (its only
  deps are the network ones, npm and the account), `setup-cloud.ts` its signed-in half (account
  check, machine registration, pull or create, `--disconnect`), `sync.ts` the edit path of
  `install`, `remove` and `--off` (pull whole, change, install, load, push with one replay),
  `latest.ts` is `setup --latest` (the diff and summary, the new tree loaded before it becomes
  current, then the same push with the lock counting),
  `account.ts` the account seam (`signedInAccount`: bearer fetch to the API origin plus the account
  id from introspection; null when signed out), `plan.ts` is `setup --dry-run` and `setup --check`,
  `install.ts` adds one extension (npm is its only seam; a kit-built working copy prints `linked`), `remove.ts` takes one out (`--purge` asks
  through an `isTTY`/`prompt` seam), `secrets-prompt.ts` asks for or lists missing secrets
  (`isTTY`/`prompt` are its only seam), `delegate.ts` registers one stub per contributed command and
  hands it to the extension), `build.ts` is `extension build`: a thin command over the kit's
  `@agentage/extension/tool` (`build`, `buildLines`), imported on use; `kit-tool.ts` is the rest of
  that seam (`runCommand`, `checkCli`, `up`, `down`, `token`, `loadKitTool`, `kitCheck`), `up.ts`
  is `extension up`, `down` and `token` over it, `kit-commands.ts` registers a kit-built
  extension's `agentage {id}` group and top-level verbs; `status/account-status.ts`
  is what `status` asks the account (seen, the profile's etag)
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
    seam), `push.ts`: push with one replay on 412 and the npm-major lock rule (`lockCounts`: a new
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
  - `installer/` - `npm.ts` (`node npm-cli.js`, scrubbed env, `--registry` default; the `Npm` seam
    for `ci`, `install` and `update`, the `NpmManifest` seam for `pack` and `view`),
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
  412 and creation, `/v1/machines`, a request log, `fail` per route) for the `account` seam; all
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

## Conventions
- `AGENTAGE_SITE_FQDN` selects the target host (production default); `AGENTAGE_CONFIG_DIR`
  overrides the config dir - e2e isolation depends on it, never remove
- `npm run verify` before any push; CI also runs `test:coverage` (global 65/70/70/70, `src/lib/**`
  and `src/core/**` have higher floors in `vitest.config.ts`)
- Exit codes: 0 ok (incl. `--help`/`--version`) / 1 step failed / 2 usage; errors on stderr
- Every network call in `lib/auth` goes through `cliFetch`; no bare `fetch`
- Conventional commits; publish only via the release workflow, never local `npm publish`
- This is a PUBLIC repo: no secrets, no internal hosts, no roadmap, no provider names in
  code, docs, comments, or commit messages
