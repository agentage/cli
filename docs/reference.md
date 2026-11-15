# Command reference

Every `agentage` command, its exit codes and environment variables. Run
`agentage <command> --help` for the authoritative flags. Global flags: `-V, --version`
prints the version, `-h, --help` prints help.

## setup

```bash
agentage setup                # browser OAuth 2.1 sign-in (PKCE), then prints status
agentage setup --no-browser   # print the sign-in URL instead of opening a browser
agentage setup --reauth       # force a fresh sign-in
agentage setup --disconnect   # sign out and remove local credentials
agentage setup --no-daemon    # do not start the daemon
```

No passwords touch the terminal; tokens are stored in `~/.agentage/auth.json`
(mode 0600). Running `setup` while signed in validates the session and prints status
instead of starting a new sign-in; an expired session falls through to a fresh sign-in.

After sign-in, the browser returns to `http://localhost:<port>/callback` on this machine. So
open the sign-in URL in a browser on this same machine. On a server, use a personal access token
instead (see [Token auth](#token-auth-ci-and-headless)).

Plain `setup` ends by starting the [daemon](#daemon) when none runs and prints
`daemon running on 127.0.0.1:<port>`. The daemon needs no account. `--no-daemon` or
`AGENTAGE_NO_DAEMON=1` leave it off. When the daemon cannot start (for example `port_in_use`),
`setup` has done the account step and the status report, then exits 1 with that error (with
`--json`, the error envelope). With `AGENTAGE_TOKEN` set, `--reauth` does nothing and says so.

`setup` also installs extensions:

```bash
agentage setup --profile ./profile.json            # save a profile file and install it, no sign-in
agentage setup --profile ./profile.json --dry-run  # print the plan, write nothing
agentage setup --check                             # exit 1 when setup would change anything
agentage setup --latest                            # newest versions the ranges allow (below)
agentage setup                                     # sign in; on a new machine, install your account's profile
```

`--profile <file>` validates the file (schema v1), saves it as `profile.json` (mode 0600,
keeping this machine's own `machines[<id>]` entry), records `profileSource: "file"` in
`machine.json` and installs it as plain `setup` does (below); it never signs in. Every version
must be a semver range or an
`https:` tarball URL (`npm:`, `github:`, `file:`, `http:` and local paths are refused); a refused
profile names each entry and the rule and writes nothing. `--disconnect` skips the extension
steps.

Plain `setup` signs in and pulls the profile in your account (below), and installs it once per
machine: the marker `setup.profile-installed` is written when every entry was tried, and a later
plain `setup` installs nothing and prints
`extensions your account profile was installed here already; setup installs nothing (agentage extension install)`,
so an extension you removed does not come back. An `extension install` before the first `setup`
does not block it. `setup --profile <file>` is an explicit ask and is never gated: it installs
each entry of the file that is not installed yet. Either way, an entry already in
`installation.json` is left as it is (`<id> already installed`). Each `@agentage/extension-<id>`
entry goes to the daemon by id (`POST /host/extensions`, as `extension install <id>` sends it):
an exact version as it is, a range at the market's newest version. An entry this machine's
profile turns `off` is installed, then disabled. The daemon runs it; `setup` loads no extension
itself, and nothing else installs. A failed entry is reported and does not stop the others;
`setup` then exits 1 (`extension_failed`) naming each. With the daemon off (`--no-daemon`,
`AGENTAGE_NO_DAEMON=1`) it prints `extensions the daemon is off, nothing installed` and writes no
marker.
`extensions/trees/` is read-only for this cli: nothing switches or deletes it.
An entry the daemon refuses, or a package that is not `@agentage/extension-<id>`, fails `setup`
(exit 1, `extension_failed`) after the others, naming each.

### The profile in your account

Signed in, the profile lives in your account: one document under one ETag. `profile.json` is
this machine's copy. Plain `setup` pulls it and never pushes a change. "Installs" below means: on
a first run, through the daemon (above).

| Your account answers                                   | `setup`                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `304`, the copy here is current (sent `If-None-Match`) | installs from `profile.json`                                                                                                                                                                                                                                                             |
| `200`, a newer profile                                 | replaces `profile.json`, prints `profile    pulled from your account (etag "...")` and installs it                                                                                                                                                                                       |
| `404 PROFILE_NOT_FOUND`, no profile yet                | installs this machine's `profile.json` (the built-in default when there is none), then creates it in your account with `If-None-Match: *`; when another machine created one first, takes that one and installs it                                                                        |
| `5xx`, another `404`, no network or a timeout          | prints `cloud profile unavailable, using local profile.json (<reason>)` on stderr and installs from it; with no `profile.json` it prints `cloud profile unavailable and no local profile.json, nothing installed (<reason>)`, installs nothing and goes on to the status report (exit 0) |

The profile in your account is no longer changed by any command but the first signed-in `setup`
(which creates it). The lifecycle commands (`extension install`, `remove` and the others) change
only the daemon's `installation.json` (see [Extension lifecycle](#extension-lifecycle)); they do
not push to your account, and another machine's `setup` does not see their changes.

`machine.json` says where `profile.json` came from:

| `profileSource` | `profile.json` is                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud`         | a copy of the profile in your account, at the ETag in `profileEtag`                                                                             |
| `file`          | from `setup --profile`: never pulled or pushed; a later `setup` prints `profile    from a file (setup --profile), not synced with your account` |
| `default`       | this machine's own: never signed in, or after `setup --disconnect`                                                                              |

`setup --profile` makes no call to your account. The first signed-in `setup` records your
account in `machine.json` as `accountId`; signed in to another account later, `setup` exits 1
naming both accounts.
`agentage setup --disconnect` forgets `accountId` and `profileEtag` (a `cloud` copy becomes
`default`), and the next `agentage setup` connects the machine to the account it signs in to.

This machine is also one of your account's machines: every signed-in `setup` registers it (its
`machine.json` id and name, platform, CLI version and `connected`), `setup` and `status` mark it
seen, and `setup --disconnect` marks it `disconnected`. None of these calls takes longer than 2
seconds, fails a command or prints anything; with `AGENTAGE_DEBUG=1` each prints one line on
stderr. `setup --profile` registers nothing.

### setup --latest

`setup --latest` is the old name of `agentage extension update` (see
[Extension lifecycle](#extension-lifecycle)): it says so on stderr and runs it.

### The plan: what setup would install

`setup --dry-run` and `setup --check` read `profile.json` (or the `--profile` file) and
`installation.json` only, never the 0.51 tree, and say what `setup` would send to the daemon:

| Verb        | Line                                        | Meaning                                                       |
| ----------- | ------------------------------------------- | ------------------------------------------------------------- |
| `add`       | `+ add <name> <range>`                      | in the profile, not installed: setup installs it              |
| `off`       | `o off <name> <range> (installed disabled)` | the same, turned off on this machine: installed disabled      |
| `unchanged` | (not printed)                               | installed already (or the account profile was installed here) |

`update` and `remove` stay in the summary and are always 0: setup changes no installed entry.

```
dry run    nothing written
registry   default    https://registry.npmjs.org
+ add @agentage/extension-notes ^1
plan: 1 to add, 0 off, 2 already installed
```

`--check` prints the same lines without the header and exits 1 when anything would be installed
(`not converged: 1 to add, 1 to install disabled`) or when `machine.json` is missing (it is read,
never created); else 0. It writes nothing. With `--json`, both print the plan object, `--check`
adding `problems`; the shape is the one of 0.51, `current` is `"installed"` or `null`:

```json
{
  "extensions": [
    { "verb": "add", "name": "@agentage/extension-notes", "wanted": "^1", "current": null }
  ],
  "summary": { "add": 1, "update": 0, "remove": 0, "off": 0, "unchanged": 0 },
  "problems": []
}
```

Without `--profile` both plan against the local `profile.json`. Neither signs in. A 0.51 tree is
still checked by `extension doctor`: an `integrity` in `extensions/package-lock.json` other than
the one in the lock inside the tree shows that extension `invalid` (`integrity drift`).

A profile names its extensions and, optionally, the npm-compatible registry each scope comes
from:

```json
{
  "version": 1,
  "extensions": { "@agentage/example": "^1.0.0" },
  "registries": { "@agentage": "https://registry.npmjs.org" }
}
```

`registries` maps an npm scope to a registry URL, which must be `https:` (or `http:` on a loopback
host); anything else is refused naming the entry, e.g. `registries["@acme"]`. Scopes it does not
list, and unscoped packages, come from `https://registry.npmjs.org`. The installer writes one
`@scope:registry=<url>` line per entry into the tree's own `.npmrc`, so the same profile builds the
same tree on every machine.

After installing, `setup` prints one `install` line, lists the secrets to set, loads every
extension this machine can run once, then prints the `extension doctor` rows with the result of
that load:

```
install    4 extensions in tree 3f9c1a0b7d2e4c51 (npm install)
secrets to set: secret.token
hello   ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello
secret  ok         @agentage/fixture-secret 1.0.0 (wants ^1)
throws  failed     @agentage/fixture-throws 1.0.0 (wants ^1)  "boom"
world   ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world
```

Loading an extension imports its entry and awaits its `register(ctx)` for at most 10 seconds.
Extensions load in peer order (an extension after the extensions it peer-depends on); one that
throws or does not finish in time is `failed` with its message (`"timeout"`), the others still
load, and an extension whose peer did not load is `blocked`, naming the peer. `invalid`, `off`
and `blocked` extensions are never loaded. `AGENTAGE_TOKEN` is removed from the environment
before the first extension is imported, and what an extension prints while loading goes to
stderr. `setup` exits 1 when any extension `failed`.

Secrets an extension declares (`"secret": true` in its `configuration`) and this machine has not
set are asked for before loading, without echo, when `setup` runs on a terminal; anywhere else
they are listed as `secrets to set: <id>.<key>`. A failed install loads nothing: the rows show
what is still current.

Extension authors: see [`extensions.md`](extensions.md).

Extensions run in the CLI process with your privileges: installing one is an act of trust.
What they keep, and what the CLI keeps about them, lives in the config directory:

| Path              | What                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `state/<id>.json` | the last load, written by the CLI: `{ at, pid, state, error, version, lastOk }`        |
| `commands.json`   | which kit-built extension holds each top-level command, `{ "<command>": "<package>" }` |
| `secrets.json`    | secrets per extension id (mode 0600, never synced)                                     |
| `logs/<id>.log`   | the extension's own log, one JSON line per entry (0600, kept under 1 MB)               |
| `data/<id>/`      | the extension's durable data (`ctx.data`); only `remove --purge` deletes it            |
| `cache/<id>/`     | the extension's disposable cache (`ctx.cache`), created by the extension               |

The installer runs npm 10 or newer as `node npm-cli.js` (no shell, `--ignore-scripts`,
`npm_config_*` and `NODE_OPTIONS` removed from its environment, at most 10 minutes per run) into
a staged tree under the extensions directory (`AGENTAGE_EXTENSIONS_DIR`, default
`extensions` in the config directory):

| Path                                | What                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `extensions/package.json`           | the install set, sorted, `private: true`, no scripts               |
| `extensions/package-lock.json`      | npm's lock for the current tree                                    |
| `extensions/trees/<hash>/`          | an immutable tree named by the lock's `name@version+integrity` set |
| `extensions/trees/<hash>/.npmrc`    | the profile's `registries`, one `@scope:registry=<url>` per line   |
| `extensions/trees/<hash>/.complete` | written once npm succeeded; a tree without it is ignored           |
| `extensions/current`                | one line naming the tree in use, rewritten atomically              |
| `extensions/install.lock`           | held for the whole install; a second run waits for it              |

`npm ci` runs when the lock matches `package.json`, `npm install` otherwise; a complete
tree for the same lock is reused without npm, and an empty install set skips npm and
points `current` at an empty tree. Two machines with the same profile get the same tree
name, because the name is a hash of the normalized lock. If npm fails, `current` is left as
it was, the staged tree is removed and npm's last 20 lines are printed; `setup` still prints
the extension rows, then exits 1. Once an install or `setup --latest` succeeded, every tree but
the one `current` names is deleted: `extensions/package-lock.json` can rebuild any of them. A
staged tree (`.staging-*`) is only ever removed by the next run that holds `install.lock`.

## status

```bash
agentage status                   # version, update, target, sign-in state, endpoint
agentage status --json            # the same report as JSON on stdout
agentage status --token aga_...   # check with a personal access token
```

`status` also surfaces a passive hint when a newer version is available.

`status` adds three lines after the ones above, and `--json` adds four keys after the existing
ones:

| Line         | JSON key     | Meaning                                                                                  |
| ------------ | ------------ | ---------------------------------------------------------------------------------------- |
| `machine`    | `machine`    | this machine's id and name from `machine.json` (created on first use)                    |
| `profile`    | `profile`    | `version <n> (source: cloud, file or default)`, `no profile` or `invalid`                |
| `extensions` | `extensions` | the extensions in `installation.json` (before the move: the profile, dev paths and tree) |
|              | `plan`       | the plan summary: `{ add, update, remove, off, unchanged }`                              |

For a copy of the profile in your account the line also shows its ETag, and the account's
version and ETag when another machine pushed since:
`profile    version 1 (source: cloud, etag "Wm9y3hQe1kP2c8sA"); account: version 1, etag "Qb7Lr0Zt4nVx2Hc9" - run agentage setup`
(one conditional request, at most 2 seconds; when your account cannot be reached the line shows
the local copy only). Signed in, `status` also marks this machine seen in your account, and
`--json` adds `machine.registered`: `true` when your account knows this machine, `false` when it
answers that it does not (`404 MACHINE_NOT_FOUND`), `null` signed out or when it cannot tell (no
answer in time, or any other answer, such as a `404` from an API without the machines route).

Extension code is never loaded and the only file written is `machine.json`. With no profile it
prints `no profile` and exits 0; an invalid `profile.json` still prints the report, then
exits 1 naming each bad entry on stderr. The rows themselves are in `extension doctor`. Once
`installation.json` exists, `status` and `extension doctor` read it, not the profile.

## Extension lifecycle

```bash
agentage extension install probe                   # the market's newest version, then it runs
agentage extension install probe@0.6.2             # that version; over an installed one: change to it, data kept
agentage extension install ./extension-demo        # a local folder, run in place (no copy)
agentage extension list                            # id, version, source (market or folder), state
agentage extension list --available                # what the market offers, with the newest versions
agentage extension update [id] [--check]           # each market extension, or one, to its newest version
agentage extension disable probe                   # stop it, keep its data
agentage extension enable probe                    # run it again
agentage extension configure probe echo.prefix=hey # set settings, no daemon restart
agentage extension configure probe token --secret  # a secret: the value from stdin, or asked on a terminal
agentage extension remove probe                    # stop and forget it; data/<id>/ stays
agentage extension remove probe --purge [--yes]    # also delete data/<id>/
```

Each command is a client of the daemon (see [daemon](#daemon)) over its `/host/extensions`
routes, and starts the daemon when none runs. The daemon holds the list in `installation.json`
in the config folder and runs each extension as its own process: its api at
`127.0.0.1:4243/api/<id>/`. A row's state is `starting`, `running`, `failed` (with the reason) or
`disabled`.

- **install** `<id>` asks the market for the newest version; `<id>@<version>` takes that
  version. `@agentage/extension-<id>` and `agentage-extension-<id>` are accepted for `<id>`. The
  daemon's installer reads the market entry, installs `<package>@<version>` exactly with
  `--ignore-scripts` into `extensions/packages/trees/<id>@<version>`, and checks that the
  package's `agentage.id` is `<id>`. A version already on disk (the daemon's own tree, or the
  tree cli 0.51 installed) runs from there with no network call. Over an
  installed id another version is a change to that version (go back), data kept; the same version
  changes nothing. A path (`.`, `./path`, `../path`, `/path`) sends the folder's real path; a
  folder another user can write to is refused. A failed start exits 1 with `extension_failed`.
  `--off` is the old name of install, then `disable`, and says so on stderr. A package name of
  another scope and an `https:` tarball URL, which 0.51 installed, are refused
  (`invalid_argument`) with what to type instead: install the unpacked folder (`./path`).
  The installer's errors reach you with the daemon's code:

  | Code                 | When                                                               |
  | -------------------- | ------------------------------------------------------------------ |
  | `NOT_FOUND`          | the market and npm know no such id, or no such version (404)       |
  | `MARKET_UNAVAILABLE` | no version given and the market did not answer (502)               |
  | `INSTALL_FAILED`     | npm could not install it; the message holds npm's last lines (502) |
  | `PRIVATE_ENTRY`      | the market entry has no npm package (400)                          |
  | `VALIDATION_ERROR`   | the package's `agentage.id` is another id (400)                    |

- **list** prints the daemon's rows; a folder row shows `folder` and `--json` adds its `path`.
  `--available` reads the market (paged, 200 per page, at most 20 pages; past that it stops
  with `market_unavailable` naming the cap), not the daemon.
- **update** compares each market row with the market's newest version and changes the ones that
  differ; folders are left alone. `--check` only prints `<id> <from> to <to> (available)`. After a
  change the folder of the old version goes (below).
- **disable** and **enable** stop and start the extension; data, settings and secrets stay.
- **configure** sends `<key>=<value>` pairs as settings, or with `--secret` as secrets. Values
  are sent as text; the daemon turns each into the type the manifest declares (`5` for an
  `integer`, `true` for a `boolean`), and an undeclared key or a value of the wrong type is 400
  `INVALID_SETTING`, nothing changed. The daemon starts the extension again with the new values,
  then moves its route. A secret value is never
  printed: the line names only the keys. A single `<key>` with `--secret` reads the value from
  stdin when stdin is not a terminal, else asks for it hidden; with `--json` on a terminal it is
  refused (`confirmation_required`), never asked.
- **remove** forgets the extension's settings and secrets. While another installed extension
  (a disabled one too) peer-depends on it, it exits 1 with `needed_by_dependents` naming them; `--force` removes it
  anyway. `--purge` also deletes `data/<id>/`: on a terminal it asks first (`[y/N]`), without one
  it needs `--yes`, else exits 1 with `confirmation_required` and nothing changed.

After `remove` and `update`, each folder `extensions/packages/trees/<id>@<version>` that no
`installation.json` entry uses any more is deleted; the daemon has stopped its child before it
answers. A refused change keeps the old folder. Only the daemon's own trees are deleted, never the
0.51 tree.

Error codes: the cli's own are lowercase snake_case (`confirmation_required`); a code the daemon
answers with is UPPER_SNAKE (`NOT_FOUND`, `CONFLICT`, `INVALID_SETTING`) and passes through
unchanged, in the text and in the `--json` envelope.

`extension install` and `remove` no longer change `profile.json` or the profile in your account:
`installation.json` is this machine's one list. The commands of an installed extension
(`agentage <command>`) and `agentage --help` read `installation.json` directly, so they work while
the daemon is down.

### The move from the old lists

The first `daemon run` on a machine that ran cli 0.51 reads the old lists once, before the daemon
starts, and moves them into `installation.json`:

| 0.51 entry                                                 | Moves as                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `profile.json` `extensions`, installed in the current tree | `{ id, version }` at the exact version that tree holds              |
| the same, in this machine's `off`                          | the same, with `enabled: false`                                     |
| `machine.json` `dev` folder                                | `{ id, source }`; `enabled: false` when `off` lists it              |
| `config.<id>` in the profile                               | that extension's settings in `settings.json` (values set later win) |

A moved version runs from the 0.51 tree as it is: no npm call, so the move works offline and the
commands of each moved extension stay in `agentage --help`. An entry is skipped, never run, when
its folder is gone, another user can write to it (the check of `install <path>`), its manifest is
invalid, it has no `agentage.id`, or it is not in the 0.51 tree (a plain `setup` on a new machine
installs those). Each skipped entry is listed in `installation.moved.json` beside the marker, in
the daemon log and in `daemon status` (`move skipped <entry>: <reason>`). Secrets need no move:
`secrets.json` is the same file. A moved setting gets the type the extension's manifest declares
(`"2"` becomes `2` for an `integer`); a value that fits no declared type, or a key the manifest
does not declare, is dropped and listed (`move skipped <id> setting <key>: ...`), so the extension
still starts. An extension that declares no settings keeps its values as they are.

The marker `installation.moved` is written once every entry is moved or skipped; with it the move
never runs again. An invalid `profile.json` or `machine.json` moves nothing and writes no marker:
the daemon still starts, `daemon status` shows `move: <file> is invalid ...`, and the next start
after you fix the file moves it. A stop half way loses nothing: an id already in
`installation.json` keeps its row, and the next start adds the rest. The old files stay as they
are.

### Downgrade to 0.51

cli 0.51 finds its old state as it left it: `profile.json`, `machine.json` and the tree in
`extensions/trees/`, which this cli never changes. What you changed after the update (installs,
removes, settings in `installation.json` and `settings.json`) 0.51 does not see. Stop the daemon
first with `agentage daemon stop`, then install 0.51; 0.51 has no daemon and would leave this one
running on its port.

## extension doctor

```bash
agentage extension doctor          # load every extension once, print ok or failed
agentage extension doctor --json   # { machine, profile, extensions: [...] } on stdout
```

Loads every extension this machine can run once, the way `setup` does, rewrites
`state/<id>.json` for each and prints the rows: `state` is `ok` or `failed` (with the extension's
message) for what it loaded, `blocked` for a dependent of a failed extension, and the static
state for the rest. An extension built on the extension kit is not imported by the CLI: the kit
checks that its command entry exports `create` and that its handlers are exactly the commands it
declares, `ok` or `failed` with what differs. What an extension prints while loading goes to
stderr, so `--json` stays valid JSON. Exits 1 when any extension failed, `profile.json` is
invalid, or on integrity drift.

## extension check

```bash
agentage extension check [dir]            # the six rules every build runs, on the package in dir
agentage extension check --json           # { conforms, problems: [{ rule, file, line, problem }] }
agentage extension check --write          # write the committed contracts ({id}.mcpc.json) first
```

Checks a working copy against the kit's conformance rules (manifest, entries, surface, stack,
store, sealing) and prints `manifest ok · ... · sealing ok` and `PASS <id> <version> conforms (6
rules)`, or one line per problem (`sealing: src/api/index.ts:7 reads process.env`) and `FAIL n
problems in m rules` on stderr. The store rule applies the migrations on a throwaway postgres and
prints `store skipped: no docker` without docker (`build` never skips it). Exits 1 when the
package does not conform. Until 0.42 this name was the old name of `doctor`. `--write` first
writes the contracts the package commits (the kit's `writeContracts`, `@agentage/extension` >=
0.5.1) and prints `wrote <file>` for each (on stderr with `--json`), then checks.

## extension build

```bash
agentage extension build                  # one image per part of the package in this folder
agentage extension build --push           # push them, write dist/agentage-extension.json
agentage extension build --dir ../my-ext  # another package folder
```

For extension authors and their CI: a thin command over the `@agentage/extension/tool` exports of
the extension kit, so it builds exactly what the kit's own tool builds. It checks the `agentage`
manifest in `package.json`, runs the package's `build` script, then builds one image per server
part from the kit recipe (`node:26-alpine`, production dependencies, non-root), tagged
`ghcr.io/agentage/<id>-<part>:<version>` with the labels `org.opencontainers.image.revision` (the
full commit sha: `COMMIT_SHA`, else `GITHUB_SHA`, else the checkout's `HEAD`) and
`org.opencontainers.image.created`. `--push` pushes each image (run `docker login ghcr.io` first)
and writes the build record `dist/agentage-extension.json` with every image by digest;
`--registry <host/owner>` points at another registry. Prints one line per image, then the record
path. Needs `docker` and git, and a committed tree with no changes. Exits 1 when the manifest is invalid or a build or push fails.

## extension release

```bash
agentage extension release                # in release.yml, on a v* tag push
```

What an extension's `release.yml` runs after `npm ci` and `npm run verify`, one `PASS <step>:` line
per step, `FAIL <step>: <reason>` and exit 1 on the first refusal. Reads `GITHUB_REF_NAME`,
`GITHUB_SHA`, `GITHUB_REPOSITORY` and `GH_TOKEN`; `NPM_TOKEN` is optional. In order: refuses the
id `template`, a commit not on `origin/master`, a tag that is not `v<version>` and an npm older
than 11.5.1 (OIDC). Then the guard: a version already released from this commit keeps its images
and record (`dist/agentage-extension.json` is downloaded) and only npm is retried; a tag moved to
another commit, or an image already pushed without a record, is refused; a GitHub or registry
call that fails or outlasts `--timeout` (default 60 s) stops the release. A new version runs
`build --push` and attaches `agentage-extension.json` to the tag's GitHub release (created when
missing). Last, `npm publish --access public --provenance --ignore-scripts`, skipped when the version is on npm.
Only an `E404` from `npm view` counts as not on npm; any other `npm view` error stops the release.
When the direct publish is not authorized, or `NPM_TOKEN` is set and the name is new, it runs `npm
stage publish` instead. `GH_TOKEN` (or `GITHUB_TOKEN`) goes only to `gh` and `NPM_TOKEN` only to
npm; both leave the environment first, so the image build and npm lifecycle scripts never see
them. A package with `"private": true` skips npm entirely (no `npm --version`, `view` or `publish`) and prints `PASS npm: private package, not published`. Needs git, `docker` and the `gh` CLI, and npm only for a package that is not private. Needs `docker login` to the registry first.

## extension up, down and token

```bash
agentage extension up                         # run the package in this folder on Docker
agentage extension up --dir ../my-ext         # another package folder
agentage extension down                       # remove what up started
agentage extension down --keep-data           # keep the store's volume for the next up
agentage extension token --scope probe:write  # a dev token from this folder's stack, alone on stdout
```

For extension authors: thin commands over the `@agentage/extension/tool` exports of the extension
kit, imported only when one of them runs. `up` runs the package the way a deployment does, with
Docker only: the part images built with the release recipe, the store with its migrations and
seeds, a dev token issuer and a local gateway, and prints one line per step as the kit reports
it, the last once every part is healthy. `down` removes its containers, network and store volume
(`--keep-data` keeps the volume). `token --scope <scope> [--dir <path>] [--issuer <url>]` prints a token from
the dev issuer `up` started for the package in `--dir`, trusted only by `up`. The issuer is
`--issuer` (default `http://localhost:4281`). It exits 1 when the stack holding that port is not
this package's, and names the one that is; `--issuer` asks that issuer and skips this check. It
asks Docker which stack holds the port, so it needs Docker unless `--issuer` is given. An issuer that is not an `http:` or `https:` URL is a usage error. Each exits 1 with the kit's message when
its step fails. `up` needs ports 4280 and 4281 free and refuses when another working copy holds them. It needs git with one commit, or `COMMIT_SHA` or `GITHUB_SHA` set. It does not need a clean tree.

## Extension commands

```bash
agentage hello          # a command the hello extension contributes
agentage hello --help   # that command's own help
agentage --help         # extension commands listed under each extension id
```

An extension contributes the commands its `package.json` lists in `agentage.contributes.commands`,
named `<id>` or `<id>:<name>`. The CLI reads those lists without running any extension code, so
`agentage --help` shows them grouped by extension id. Running one loads only that extension and
the extensions it peer-depends on, then hands it the command line. A command that throws, or
whose extension cannot load, exits 1 with the reason. An unknown command exits 2 and lists the
core commands, then each extension's:

```
error: unknown command 'nope'
core: setup, status, update, extension
hello: hello
world: world
```

Reading the manifests never stops `setup`, `status` or `update`: an extension with a broken
manifest contributes no commands.

### Commands of an extension built on the extension kit

```bash
agentage ping            # the command ping of the probe extension
agentage ping hi         # its args, parsed and checked by the kit
agentage probe ping hi   # the same; always works
agentage probe --help    # probe's commands from its manifest, no code run
```

A manifest with `agentage.parts` is built on the extension kit. Each command in its
`agentage.commands` runs as `agentage <command>`, and always as `agentage <id> <command>`. The CLI
hands what follows the command, `--json` and `--help` included, to the kit untouched; the kit
parses the args, runs the handler the package's command entry (`parts.cli.entry`, else
`./dist/cli/index.js`) returns from `create`, and its exit code is the CLI's: 0 ok, 2 usage, 1
failure.

A command whose name is a core command, an extension id, or a command an earlier-installed
extension already took keeps only its namespaced form, `agentage <id> <command>`; the install says
so in one line, and `extension doctor` shows that form in its commands column. Which extension holds
each top-level command is kept in `commands.json`, so the earlier install keeps it whatever is
installed later.

## Extension context

For extension authors. `register(ctx)` gets one frozen object; its types come from
`@agentage/cli/extension`:

| Member            | What                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `id`, `version`   | `agentage.id` and the package version                                                          |
| `previousVersion` | the version that last loaded ok here (`lastOk` in `state/<id>.json`); `null` on the first load |
| `mode`            | `installed`, `dev` (a local path) or `test` (`createTestContext`)                              |
| `config`          | the profile's `config.<id>`, checked against `agentage.configuration`, defaults filled         |
| `secrets`         | `get`, `set`, `delete` over `secrets.json`                                                     |
| `data`, `cache`   | the extension's own folders                                                                    |
| `log`             | one JSON line per call in `logs/<id>.log`                                                      |
| `commands`        | `add(registrar)`: commands named `<id>` or `<id>:<name>`                                       |
| `use`             | `use(id)`: the API a peer's `register` returned                                                |
| `subscriptions`   | `push(disposable)`: disposed when the CLI is done                                              |

Registration closes when `register` resolves: from then on `commands.add` and
`subscriptions.push` throw `registration closed`, while `log`, `secrets` and `use` keep working.
A `configuration` key may declare `description` (shown after the key when `setup` asks for a
secret) and `enum` (the only values allowed; any other makes the extension `invalid`, naming the
key). `use` is typed through `ExtensionApis`, an empty interface an extension fills by declaration
merging; without an entry `use(id)` returns the untyped `ExtensionApi`:

```ts
declare module '@agentage/cli/extension' {
  interface ExtensionApis {
    hello: { greet: () => string };
  }
}
// ctx.use('hello').greet() is now typed
```

To unit-test an extension without the CLI, `@agentage/cli/extension/test` exports
`createTestContext(overrides)`. It returns a frozen `ctx` with the same members and `mode` set to
`test`: `data` and `cache` in a fresh temp dir, secrets kept in memory, and a silent `log`; any
other member can be replaced through `overrides`. Its `use` option maps peer ids to fakes, and
`ctx.use` throws for any other id unless asked with `{ optional: true }`. Its `program` option is
the commander `Command` that `ctx.commands.add` registers on, so a test runs a command by parsing
it:

```js
import { Command } from 'commander';
import { createTestContext } from '@agentage/cli/extension/test';
import { register } from './index.js';

const program = new Command('agentage').exitOverride();
await register(createTestContext({ id: 'world', program, use: { hello: { greet: () => 'hi' } } }));
await program.parseAsync(['world'], { from: 'user' }); // prints "world heard: hi"
```

## daemon

```bash
agentage daemon status    # running or not: pid, port, version, each extension and its state
agentage daemon stop      # stop the daemon and every extension; returns once its pid is gone
agentage daemon restart   # stop, then start
```

The daemon is one process on `127.0.0.1` (port 4243, `AGENTAGE_DAEMON_PORT` for another). It
runs each installed extension as a child process and serves `/api/{id}/*`, `/health` and
`/host/extensions`; a request with another `Host` or `Origin` gets 403. It has no token.
`setup` starts it, and so does each command that needs it.

A daemon counts as this machine's daemon only with proof: `/health` on the port of
`<config>/daemon.json` answers `service: "agentage-daemon"` with the same `pid` as the file.
Requests go only to a proven daemon, and `stop` signals only a proven pid (SIGTERM, then SIGKILL
after 30 s). The command reads `daemon.json` and then:

| Found                                                        | What happens                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| no file, or its pid is gone                                  | the stale file is removed and `agentage daemon run` starts detached, in its own process group; the command waits for `/health` (30 s) |
| the pid lives, its port refuses the connection               | a reused pid (`daemon.json` is written after the daemon listens): the file goes, nothing is signalled, a daemon starts                |
| the pid lives, the port answers but not as that daemon       | `port_in_use`, naming the port and `AGENTAGE_DAEMON_PORT`; nothing starts                                                             |
| the pid lives, `/health` does not answer (3 tries, 2 s each) | the file stays; `daemon_unresponsive`, exit 1                                                                                         |
| a proven daemon of another protocol, or an older version     | it is stopped and started again; one line on stderr (`daemon restarted: ...`); a newer daemon serves as it is, never downgraded       |
| the port is held by another program at the start             | `port_in_use`, naming the port and `AGENTAGE_DAEMON_PORT`                                                                             |

A start that waits over 3 s, and a stop that waits over 3 s, print one line on stderr (never on
stdout, so `--json` stays one object). A start that times out checks `daemon.json` and `/health`
once more and uses a proven daemon found there; else it fails with `daemon_unavailable`, naming
`agentage daemon status` and the log path. `agentage update` restarts a running daemon after the install. `AGENTAGE_NO_DAEMON=1` makes
every command that needs the daemon fail with `daemon_disabled`; nothing starts.
The daemon writes its output, and each extension's, to `<config>/logs/daemon.log`; at each start
a log over 5 MB moves to `daemon.log.1` (one old file is kept). A daemon that cannot bind its port
exits 3. `status`, `stop` and `restart` exit 0 when no daemon runs; `status` says when a pid does
not answer, and `stop` says when it removed a stale `daemon.json`. With `--json`, `data` is
`{ running, pid, port, version, status, extensions }` (or `{ running: false, unresponsive, pid,
port }`), `{ stopped }` and `{ port }`; `status` adds `move`, the report of the
[move from the old lists](#the-move-from-the-old-lists), and prints its warning and skipped entries.

## update

```bash
agentage update           # install the latest published version via npm
agentage update --check   # report whether an update is available, don't install
```

`update` needs npm 10 or newer and prints npm's last output lines if the install fails. After
an install it restarts a running daemon, so the daemon runs the new version.

## Token auth (CI and headless)

Machines without a browser authenticate with a personal access token. Mint one in the
dashboard under **Settings -> API tokens**, then set `AGENTAGE_TOKEN=aga_...` or pass
`--token aga_...` per command. A token takes precedence over a stored sign-in. With
`AGENTAGE_TOKEN` set, plain `setup` opens no browser sign-in: its account step and its status step
use the token, then it starts the daemon.

## The --json envelope

Every core command takes `--json`. With it the command writes exactly one JSON object on stdout
and nothing else there (progress lines go to stderr), and never prompts:

```json
{ "success": true, "data": { "extensions": [] } }
{ "success": false, "error": { "code": "not_installed", "message": "probe is not installed" } }
```

An error exits 1. `code` is snake_case and stable: `not_installed`, `needed_by_dependents`,
`confirmation_required`, `extension_failed`, `profile_invalid`, `integrity_drift`,
`invalid_argument`, `invalid_option`, `not_conforming`, `uncommitted_changes`, `release_refused`,
`auth_required`, `auth_unavailable`, `not_pushed`, `token_request_failed`, `daemon_unavailable`,
`daemon_unresponsive`, `daemon_disabled`, `port_in_use`, `market_unavailable`, `error` (any other).
A code from the daemon (UPPER_SNAKE, such as `NOT_FOUND` or `INVALID_SETTING`) passes through unchanged.
A usage error (exit 2) happens before the command runs and prints no object.

| Command                                               | `data`                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `setup`                                               | `{ extensions: [...] }`, the rows as `extension doctor` has them   |
| `extension install`, `disable`, `enable`, `configure` | the daemon's row `{ id, version, source, state, enabled, error? }` |
| `extension list`                                      | the daemon's rows; a folder row has `source: "folder"` and `path`  |
| `extension list --available`                          | `[{ id, version }]` from the market                                |
| `extension update`                                    | `[{ id, from, to, updated }]`                                      |
| `extension remove`                                    | `{ id, purged }`                                                   |
| `update`                                              | `{ installed, status, latest, updated }`                           |
| `extension create`                                    | `{ id, dir, from, kept }`                                          |
| `extension build`                                     | the kit's build result                                             |
| `extension release`                                   | `{ id, version, tag, built, published }`                           |
| `extension up`, `down`                                | `{ lines }`, the lines the kit reported                            |
| `extension token`                                     | `{ token }`; nothing else is printed                               |

`setup` with `--json` does not open a browser: when it must sign in it needs `--no-browser`, else
it fails with `confirmation_required`. `extension remove --purge` with `--json` needs `--yes`, else
`confirmation_required`. Secrets are listed, never asked.

`status`, `extension doctor` and `check`, and `setup` with `--dry-run` or `--check`, keep
their own JSON (described under each command) because tools read it today. An error they hit
before printing anything is the error object; after the report it stays a red line on stderr and
exit 1. A command an extension adds takes its own `--json`, which the extension owns.

## Exit codes

| Code | Meaning                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| `0`  | Success, including `--help`, `--version`, and `status` while signed out                             |
| `3`  | Only `daemon run` (the daemon process): its port is in use                                          |
| `1`  | A step failed: sign-in, install or update failed, a refused or invalid profile, or an invalid token |
| `2`  | Usage error: an unknown command or flag, a missing flag value, or no command                        |

`setup` and `extension doctor` also exit 1 when an
extension failed to load, `extension install` and `configure` exit 1 when it failed to start or on integrity drift, `extension build` exits 1 when a build or push
fails, `extension up`, `down` and `token` exit 1 when the kit's step fails (`token` also when the stack up is another folder's), an extension command
exits 1 when its extension cannot load (a kit-built one exits with the kit's code), `setup --check` exits 1 when
the machine is not converged.
Signed in, `setup` also exits 1 when this machine is connected to another account; when your
account cannot be reached it carries on (exit 0).

Errors go to stderr; stdout carries only command output (`status --json` stays parseable).

## Environment

The extensions directory is `AGENTAGE_EXTENSIONS_DIR` when that variable is set and not empty.
Otherwise it is `extensions` inside the config directory. The config directory is
`AGENTAGE_CONFIG_DIR` when set and not empty. Otherwise it is `.agentage` in the home directory
(`$HOME`). So `AGENTAGE_CONFIG_DIR` moves the extensions directory too, unless
`AGENTAGE_EXTENSIONS_DIR` is set. `<config>` below means the config directory.

| Variable                  | Purpose                                                              | Default               |
| ------------------------- | -------------------------------------------------------------------- | --------------------- |
| `AGENTAGE_SITE_FQDN`      | Target host                                                          | `agentage.io`         |
| `AGENTAGE_CONFIG_DIR`     | Config and credentials directory (`auth.json`)                       | `$HOME/.agentage`     |
| `AGENTAGE_TOKEN`          | Personal access token for CI and headless machines                   | unset                 |
| `NO_COLOR`                | Disable colored output (any non-empty value)                         | unset                 |
| `AGENTAGE_EXTENSIONS_DIR` | Extensions directory (trees, lock, `current`)                        | `<config>/extensions` |
| `AGENTAGE_DEBUG`          | `1` prints one stderr line for each call that registers this machine | unset                 |
| `AGENTAGE_DAEMON_PORT`    | The daemon's port on 127.0.0.1                                       | `4243`                |
| `AGENTAGE_NO_DAEMON`      | `1`: no daemon is started or used (`daemon_disabled`)                | unset                 |
