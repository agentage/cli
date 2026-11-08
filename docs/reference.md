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
```

No passwords touch the terminal; tokens are stored in `~/.agentage/auth.json`
(mode 0600). Running `setup` while signed in validates the session and prints status
instead of starting a new sign-in; an expired session falls through to a fresh sign-in.

`setup` also installs extensions:

```bash
agentage setup --profile ./profile.json            # install and load a profile file, no sign-in
agentage setup --profile ./profile.json --dry-run  # print the plan, write nothing
agentage setup --check                             # exit 1 when setup would change anything
agentage setup --latest                            # newest versions the ranges allow (below)
agentage setup                                     # sign in, then install your account's profile
```

`--profile <file>` validates the file (schema v1), saves it as `profile.json` (mode 0600,
keeping this machine's own `machines[<id>]` entry), records `profileSource: "file"` in
`machine.json` and installs; it never signs in. Every version must be a semver range or an
`https:` tarball URL (`npm:`, `github:`, `file:`, `http:` and local paths are refused); a refused
profile names each entry and the rule and writes nothing. Plain `setup` signs in, then installs
the profile in your account (below). `--disconnect` skips the extension steps.

### The profile in your account

Signed in, the profile lives in your account: one document, with npm's lock and the npm major
that wrote it, under one ETag. `profile.json` is this machine's copy. Plain `setup` pulls it
and never pushes a change:

| Your account answers                                   | `setup`                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `304`, the copy here is current (sent `If-None-Match`) | installs from `profile.json`                                                                                                                                                                                                                                                             |
| `200`, a newer profile                                 | replaces `profile.json`, installs from the account's lock (`npm ci` when it matches) and prints `profile    pulled from your account (etag "...")`                                                                                                                                       |
| `404 PROFILE_NOT_FOUND`, no profile yet                | installs this machine's `profile.json` (the built-in default when there is none), then creates it in your account with `If-None-Match: *`; when another machine created one first, takes that one and installs it                                                                        |
| `5xx`, another `404`, no network or a timeout          | prints `cloud profile unavailable, using local profile.json (<reason>)` on stderr and installs from it; with no `profile.json` it prints `cloud profile unavailable and no local profile.json, nothing installed (<reason>)`, installs nothing and goes on to the status report (exit 0) |

`extension install`, `extension remove` and `extension install --off` change the profile in your
account: they pull it whole, apply the change to it, install and load, and only then push the
profile, `extensions/package-lock.json` and the npm major with `If-Match`
(`profile    pushed to your account (etag "...")`). When another machine pushed in between
(`412`), the change is replayed once on that newer profile, installed, loaded and pushed again;
a second `412` exits 1 showing both documents. A change your account already holds sends
nothing. A lock written by another npm major than the one your account recorded is not pushed;
the account keeps its own. A failed load pushes nothing. When your account cannot be reached
before the change, nothing changes and the command exits 1; when the push fails after the tree
loaded, the change is on this machine only and the command exits 1 asking to run it again.

`machine.json` says where `profile.json` came from:

| `profileSource` | `profile.json` is                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud`         | a copy of the profile in your account, at the ETag in `profileEtag`                                                                             |
| `file`          | from `setup --profile`: never pulled or pushed; a later `setup` prints `profile    from a file (setup --profile), not synced with your account` |
| `default`       | this machine's own: never signed in, or after `setup --disconnect`                                                                              |

`setup --profile` makes no call to your account. The first signed-in `setup` records your
account in `machine.json` as `accountId`; signed in to another account later, `setup`,
`extension install` and `extension remove` exit 1 naming both accounts.
`agentage setup --disconnect` forgets `accountId` and `profileEtag` (a `cloud` copy becomes
`default`), and the next `agentage setup` connects the machine to the account it signs in to.

This machine is also one of your account's machines: every signed-in `setup` registers it (its
`machine.json` id and name, platform, CLI version and `connected`), `setup` and `status` mark it
seen, and `setup --disconnect` marks it `disconnected`. None of these calls takes longer than 2
seconds, fails a command or prints anything; with `AGENTAGE_DEBUG=1` each prints one line on
stderr. `setup --profile` registers nothing.

### setup --latest

```
~ update @agentage/fixture-hello 1.0.0 -> 1.0.1
latest: 1 updated, 1 unchanged in tree 9a3e5c0d1b7f2a64
hello  ok         @agentage/fixture-hello 1.0.1 (wants ^1.0.0)  commands: hello
world  ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world
```

`--latest` runs `npm update --ignore-scripts` (the same npm, flags and registries as an install)
in a staged copy of the installed tree: the profile's ranges as `package.json`, the current lock,
the `.npmrc` of the profile's `registries`. Each extension moves to the newest version its range
allows. It then compares the normalized lock before and after and prints one line per extension
whose version changed (`~ update <name> <from> -> <to>`; `+ add` and `- remove` when the tree and
the profile differed) and a summary. The new tree is loaded from where it was built, and becomes
`extensions/current` only when no extension in it `failed` or is `invalid`; otherwise the command
exits 1 with `not updated: <id> <state>; extensions/current is unchanged`, the new tree is
deleted and the old one stays. With nothing newer it prints `latest: nothing to update`, builds
no tree and loads nothing.

When the newest version a range allows declares an `engines.agentage` this CLI's extension API
does not satisfy, that extension stays at its installed version and
`kept       <name> <version> (<newer> needs extension API <range>)` says why; the others still
update (npm runs again without it). This never fails the run. On a machine whose profile is a
copy of your account's, `--latest` pulls the profile first, updates from the lock the account
holds, and once the new tree loaded pushes the profile with the new lock and the npm major
(`If-Match`, one replay on a `412`, as `extension install` does); when nothing changed, nothing
is pushed. `--latest` never signs in, and cannot be combined with `--profile`, `--dry-run`,
`--check` or `--disconnect` (exit 2).

### The plan: desired against current

The profile is the desired state; the installed tree (`extensions/current` and the lock it was
installed from) is the current state. `setup` converges the two, and `extension install` and
`extension remove` change the profile, then converge. The plan says what converging would do,
one verb per extension the profile or the tree names:

| Verb        | Line                                    | Meaning                                               |
| ----------- | --------------------------------------- | ----------------------------------------------------- |
| `add`       | `+ add <name> <range>`                  | in the profile, not in the tree                       |
| `update`    | `~ update <name> <range> (was <range>)` | in both, with another range than the lock recorded    |
| `remove`    | `- remove <name>`                       | in the tree, no longer in the profile                 |
| `off`       | `o off <name>`                          | installed, turned off on this machine; never a change |
| `unchanged` | (not printed)                           | in both with the same range                           |

`--dry-run` prints the registries, then one line per extension that is not unchanged, then one
summary line, and writes nothing; with nothing to change the summary is `plan: nothing to
change`:

```
dry run    nothing written
registry   @acme      https://npm.acme.example
registry   default    https://registry.npmjs.org
+ add @acme/notes ^1
- remove @acme/todo
plan: 1 to add, 0 to update, 1 to remove, 0 off, 2 unchanged
```

`--check` verifies instead of converging: it prints the same plan lines (without the header) and
exits 1 when anything would be added, updated or removed, when `extensions/package-lock.json`
does not name the same `name@version+integrity` set as the lock inside the tree `current` names
(`lock mismatch`), on integrity drift (below), or when `machine.json` is missing (it is read,
never created). It exits 0 on a converged machine, and writes nothing. With `--json`, both print
the plan object, `--check` adding `problems`:

```json
{
  "extensions": [
    { "verb": "add", "name": "@agentage/example", "wanted": "^1.0.0", "current": null }
  ],
  "summary": { "add": 1, "update": 0, "remove": 0, "off": 0, "unchanged": 0 },
  "problems": []
}
```

Without `--profile` both plan against the local `profile.json`. Neither signs in.

**Integrity drift**: the same `name@version` with another `integrity` in
`extensions/package-lock.json` than in the lock inside the current tree means one of them was
changed by hand. It is a hard error: `setup`, `extension install`, `extension remove`, `extension
check` and `setup --check` exit 1 with `integrity drift: <name@version>` before npm runs, and
`extension list` shows that extension `invalid` with the same reason. Restore the lock, or delete
`extensions/package-lock.json` to install again from the profile.

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
extension this machine can run once, then prints the `extension list` rows with the result of
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
`~/.agentage/extensions`):

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

| Line         | JSON key     | Meaning                                                                                    |
| ------------ | ------------ | ------------------------------------------------------------------------------------------ |
| `machine`    | `machine`    | this machine's id and name from `machine.json` (created on first use)                      |
| `profile`    | `profile`    | `version <n> (source: cloud, file or default)`, `no profile` or `invalid`                  |
| `extensions` | `extensions` | extensions the profile, dev paths and tree name, then the pending changes: `(1 to remove)` |
|              | `plan`       | the plan summary: `{ add, update, remove, off, unchanged }`                                |

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
exits 1 naming each bad entry on stderr. The rows themselves are in `extension list`.

## extension install

```bash
agentage extension install @agentage/example          # add it at ^<newest version that fits>, install, load
agentage extension install @agentage/example@~1.2     # the same, with the range as typed
agentage extension install example                    # short name: @agentage/extension-example, else agentage-extension-example
agentage extension install @agentage/example --off    # install it, but do not load it on this machine
agentage extension install ./my-extension             # a dev extension from a local folder
agentage extension install .                          # link the working copy you are in
```

`<name>` is resolved in this order:

1. `.`, `./path`, `../path` or `/path`: a dev extension, the working copy linked. The folder needs
   a `package.json` with a `name` and `agentage.id`; its real path goes into `machine.json` under
   `dev`, keyed by package name, and the profile is not changed. It loads on this machine only, in
   place of an installed copy of the same package. `--off` is refused for it: a dev extension
   always loads. A working copy built on the extension kit prints
   `linked     <package> (working copy)`, others `dev        <package> <path>`.
2. `http:`, `file:`, `npm:` and `github:` (and any other scheme but `https:`) are refused, naming
   the rule; nothing is written.
3. An `https:` tarball URL is kept as written, under the package name the tarball declares.
4. A scoped name, or one starting with `agentage-extension-`, is used as written. With an
   `@<range>` suffix the range is kept as typed. Without one it is pinned to `^<version>`, the
   newest release whose `engines.agentage` (absent means `^1`) the extension API satisfies,
   rather than the `latest` tag; for a release built on the extension kit (its manifest has
   `agentage.parts`) the range is over the kit's version instead. Each newer release that needs
   another API prints `skipped    <version>: needs extension API <range>` (or `needs kit
<range>`). When no release fits, the command exits 1 naming the newest and what it needs.
   Prereleases are never picked.
5. Any other name is a short name: `example` is `@agentage/extension-example`, else
   `agentage-extension-example`, whichever the registry has first; with neither, the command exits
   1 naming both.

npm reads each name from the registry the local profile's `registries` names for its scope
(`npm view` for a name without a range, `npm pack --dry-run` otherwise; nothing installed), so a
missing package or a range nothing satisfies
fails before anything is written. A package goes into `profile.json` `extensions` (created from
the default profile when absent; installing a name again replaces its range); on a machine whose
profile is a copy of your account's, the change goes to your account (see
[The profile in your account](#the-profile-in-your-account)), otherwise `profileSource` stays
`file` for a file profile and is `default`. `--off` adds the package name to this
machine's `machines[<id>].off`; installing without `--off` takes it out again. Then the command
installs and loads the way `setup` does and prints the same rows; it exits 1 when the install or
an extension failed. An invalid `profile.json`, or one from a newer schema, is refused and never
overwritten. It never signs in. When a command of a kit-built extension keeps only its namespaced
form (see [Extension commands](#extension-commands)), one line says so after the rows:
`namespaced agentage pong ping (agentage ping is taken by extension probe)`.

## extension remove

```bash
agentage extension remove @agentage/example        # by package name
agentage extension remove example                  # by short name or extension id
agentage extension remove example --purge          # also delete data/<id>/, after asking
agentage extension remove example --purge --yes    # the same without asking (needed off a terminal)
```

`<name>` is a package name, a short name (matched against the profile and the dev paths as
`extension install` resolves it) or an extension id. The command exits 1 when nothing matches,
and while any other extension in the profile or a dev path peer-depends on it, naming those
extensions; remove them first. Otherwise it takes the package out of `profile.json` `extensions`
and this machine's `off` list, out of `machine.json` `dev` when it was a dev extension, deletes
`state/<id>.json`, then installs and loads the rest the way `setup` does (npm installs a tree
without it) and, like `extension install`, pushes the profile to your account when it is a copy
of your account's. `logs/<id>.log`, `secrets.json` and `config.<id>` in the profile are kept.

`--purge` also deletes `data/<id>/`. On a terminal it asks first (`[y/N]`, before anything
changes); answering anything but `y` removes the extension and keeps its data. Without a terminal
`--purge` needs `--yes` and otherwise exits 1 with nothing changed; `--yes` skips the question on
a terminal too.

## extension list

```bash
agentage extension list          # one row per extension
agentage extension list --json   # { machine, profile, plan, extensions: [...] } on stdout
agentage extension               # the extension command help
```

One row per extension in the profile, a dev path or the installed tree, read from the installed
tree, the profile and the state files; extension code is never loaded and the only file written
is `machine.json`. An invalid `profile.json` still prints the rows, then exits 1. An extension
the tree holds but the profile no longer names is listed `installed` with `remove` and `(not in
profile)` until `setup` removes it; it is never loaded. The drift
column is left out when every row is blank.

| Column   | JSON field  | Meaning                                                                                                         |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| id       | `id`        | `agentage.id` from the extension's `package.json`                                                               |
| state    | `state`     | `installed`, `off`, `blocked`, `invalid` or `missing`                                                           |
| drift    | `plan`      | `add`, `update` or `remove`; blank otherwise (`plan` is also `off`, `unchanged`, or `null` for a dev extension) |
| package  | `package`   | package name; `mode` is `dev` for a local path in `machine.json`                                                |
| version  | `installed` | version found in the installed tree                                                                             |
| wants    | `wanted`    | range or `https:` URL from the profile's `extensions`                                                           |
| commands | `commands`  | `agentage.contributes.commands`                                                                                 |
| last run | `lastRun`   | `state/<id>.json`: `at`, `state` (`ok` or `failed`), `error`                                                    |
| reason   | `error`     | why the extension is `invalid`, `blocked` or `missing`                                                          |

An extension is `off` when this machine's `machines[<id>].off` in the profile lists it, `blocked`
when an extension it peer-depends on is not `installed`, `invalid` when its manifest is wrong (a
duplicate `agentage.id`, an `engines.agentage` range the extension API does not satisfy, no entry
point, a contributed command not named after the id), the profile's `config.<id>` holds a value of
the wrong type or outside the declared `enum` for a key the extension declares, its locked
integrity drifted, or it is a dev extension whose folder anyone can write to or another user owns
(root may own it; not checked on Windows), and `missing` when it is not in the installed tree.
Declared defaults fill the keys the profile leaves out. `invalid` extensions are never imported.
The JSON adds a top-level `plan`, the summary `{ add, update, remove, off, unchanged }`.

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
0.5.1) and prints `wrote <file>` for each, then checks.

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
path. Needs `docker`. Exits 1 when the manifest is invalid or a build or push fails.

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
missing). Last, `npm publish --access public --provenance`, skipped when the version is on npm;
when the direct publish is not authorized, or `NPM_TOKEN` is set and the name is new, it runs `npm
stage publish` instead. Needs `docker login` to the registry first.

## extension up, down and token

```bash
agentage extension up                         # run the package in this folder on Docker
agentage extension up --dir ../my-ext         # another package folder
agentage extension down                       # remove what up started
agentage extension down --keep-data           # keep the store's volume for the next up
agentage extension token --scope probe:write  # a dev token, alone on stdout
```

For extension authors: thin commands over the `@agentage/extension/tool` exports of the extension
kit, imported only when one of them runs. `up` runs the package the way a deployment does, with
Docker only: the part images built with the release recipe, the store with its migrations and
seeds, a dev token issuer and a local gateway, and prints one line per step as the kit reports
it, the last once every part is healthy. `down` removes its containers, network and store volume
(`--keep-data` keeps the volume). `token --scope <scope> [--issuer <url>]` prints a token from
the dev issuer `up` started (default `http://localhost:4281`), trusted only by `up`; an issuer
that is not an `http:` or `https:` URL is a usage error. Each exits 1 with the kit's message when
its step fails.

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
so in one line, and `extension list` shows that form in its commands column. Which extension holds
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

## update

```bash
agentage update           # install the latest published version via npm
agentage update --check   # report whether an update is available, don't install
```

`update` needs npm 10 or newer and prints npm's last output lines if the install fails.

## Token auth (CI and headless)

Machines without a browser authenticate with a personal access token. Mint one in the
dashboard under **Settings -> API tokens**, then set `AGENTAGE_TOKEN=aga_...` or pass
`--token aga_...` per command. A token takes precedence over a stored sign-in.

## Exit codes

| Code | Meaning                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| `0`  | Success, including `--help`, `--version`, and `status` while signed out                             |
| `1`  | A step failed: sign-in, install or update failed, a refused or invalid profile, or an invalid token |
| `2`  | Usage error: an unknown command or flag, a missing flag value, or no command                        |

`setup`, `extension install`, `extension remove` and `extension doctor` also exit 1 when an
extension failed to load or on integrity drift, `extension build` exits 1 when a build or push
fails, `extension up`, `down` and `token` exit 1 when the kit's step fails, an extension command
exits 1 when its extension cannot load (a kit-built one exits with the kit's code), `setup --check` exits 1 when
the machine is not converged, and `setup --latest` exits 1 when the new tree did not load clean.
Signed in, `setup` also exits 1 when this machine is connected to another account; when your
account cannot be reached it carries on (exit 0). `extension install`, `extension remove` and
`setup --latest` on a copy of your account's profile exit 1 when your account cannot be reached,
a push fails, or a second push conflict shows both documents.

Errors go to stderr; stdout carries only command output (`status --json` stays parseable).

## Environment

| Variable                  | Purpose                                                              | Default                  |
| ------------------------- | -------------------------------------------------------------------- | ------------------------ |
| `AGENTAGE_SITE_FQDN`      | Target host                                                          | `agentage.io`            |
| `AGENTAGE_CONFIG_DIR`     | Config and credentials directory (`auth.json`)                       | `~/.agentage`            |
| `AGENTAGE_TOKEN`          | Personal access token for CI and headless machines                   | unset                    |
| `NO_COLOR`                | Disable colored output (any non-empty value)                         | unset                    |
| `AGENTAGE_EXTENSIONS_DIR` | Extensions directory (trees, lock, `current`)                        | `~/.agentage/extensions` |
| `AGENTAGE_DEBUG`          | `1` prints one stderr line for each call that registers this machine | unset                    |
