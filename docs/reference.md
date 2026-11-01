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

With `AGENTAGE_EXTENSIONS=1`, `setup` also installs extensions:

```bash
agentage setup --profile ./profile.json            # install and load a profile file, no sign-in
agentage setup --profile ./profile.json --dry-run  # print the plan, write nothing
agentage setup --check                             # exit 1 when setup would change anything
agentage setup                                     # sign in, then install and load profile.json
```

`--profile <file>` validates the file (schema v1), saves it as `profile.json` (mode 0600,
keeping this machine's own `machines[<id>]` entry), records `profileSource: "file"` in
`machine.json` and installs; it never signs in. Every version must be a semver range or an
`https:` tarball URL (`npm:`, `github:`, `file:`, `http:` and local paths are refused); a refused
profile names each entry and the rule and writes nothing. Plain `setup` signs in, then installs
from the local `profile.json`; with none it saves the built-in default profile (no extensions)
locally and says the cloud profile is unavailable. `--disconnect` skips the extension steps.

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

| Path              | What                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `state/<id>.json` | the last load, written by the CLI: `{ at, pid, state, error, version, lastOk }` |
| `secrets.json`    | secrets per extension id (mode 0600, never synced)                              |
| `logs/<id>.log`   | the extension's own log, one JSON line per entry (0600, kept under 1 MB)        |
| `data/<id>/`      | the extension's durable data (`ctx.data`); only `remove --purge` deletes it     |
| `cache/<id>/`     | the extension's disposable cache (`ctx.cache`), created by the extension        |

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
the extension rows, then exits 1.

## status

```bash
agentage status                   # version, update, target, sign-in state, endpoint
agentage status --json            # the same report as JSON on stdout
agentage status --token aga_...   # check with a personal access token
```

`status` also surfaces a passive hint when a newer version is available.

With `AGENTAGE_EXTENSIONS=1`, `status` adds three lines after the ones above, and `--json` adds
four keys after the existing ones:

| Line         | JSON key     | Meaning                                                                                    |
| ------------ | ------------ | ------------------------------------------------------------------------------------------ |
| `machine`    | `machine`    | this machine's id and name from `machine.json` (created on first use)                      |
| `profile`    | `profile`    | `version <n> (source: file or default)`, `no profile` or `invalid`                         |
| `extensions` | `extensions` | extensions the profile, dev paths and tree name, then the pending changes: `(1 to remove)` |
|              | `plan`       | the plan summary: `{ add, update, remove, off, unchanged }`                                |

Extension code is never loaded and the only file written is `machine.json`. With no profile it
prints `no profile` and exits 0; an invalid `profile.json` still prints the report, then
exits 1 naming each bad entry on stderr. The rows themselves are in `extension list`.

## extension install

Needs `AGENTAGE_EXTENSIONS=1`.

```bash
agentage extension install @agentage/example          # add it to profile.json at ^<latest>, install, load
agentage extension install @agentage/example@~1.2     # the same, with the range as typed
agentage extension install example                    # short name: @agentage/extension-example, else agentage-extension-example
agentage extension install @agentage/example --off    # install it, but do not load it on this machine
agentage extension install ./my-extension             # a dev extension from a local folder
```

`<name>` is resolved in this order:

1. `./path`, `../path` or `/path`: a dev extension. The folder needs a `package.json` with a
   `name` and `agentage.id`; its real path goes into `machine.json` under `dev`, keyed by package
   name, and the profile is not changed. It loads on this machine only, in place of an installed
   copy of the same package. `--off` is refused for it: a dev extension always loads.
2. `http:`, `file:`, `npm:` and `github:` (and any other scheme but `https:`) are refused, naming
   the rule; nothing is written.
3. An `https:` tarball URL is kept as written, under the package name the tarball declares.
4. A scoped name, or one starting with `agentage-extension-`, is used as written. Without an
   `@<range>` suffix it is pinned to `^<latest>`.
5. Any other name is a short name: `example` is `@agentage/extension-example`, else
   `agentage-extension-example`, whichever the registry has first; with neither, the command exits
   1 naming both.

npm reads each name from the registry the local profile's `registries` names for its scope
(`npm pack --dry-run`, nothing installed), so a missing package or a range nothing satisfies
fails before anything is written. A package goes into `profile.json` `extensions` (created from
the default profile when absent; installing a name again replaces its range); `profileSource`
stays `file` for a file profile and is `default` otherwise. `--off` adds the package name to this
machine's `machines[<id>].off`; installing without `--off` takes it out again. Then the command
installs and loads the way `setup` does and prints the same rows; it exits 1 when the install or
an extension failed. An invalid `profile.json`, or one from a newer schema, is refused and never
overwritten. It never signs in.

## extension remove

Needs `AGENTAGE_EXTENSIONS=1`.

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
without it). `logs/<id>.log`, `secrets.json` and `config.<id>` in the profile are kept.

`--purge` also deletes `data/<id>/`. On a terminal it asks first (`[y/N]`, before anything
changes); answering anything but `y` removes the extension and keeps its data. Without a terminal
`--purge` needs `--yes` and otherwise exits 1 with nothing changed; `--yes` skips the question on
a terminal too.

## extension list

Needs `AGENTAGE_EXTENSIONS=1`.

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

## extension check

Needs `AGENTAGE_EXTENSIONS=1`.

```bash
agentage extension check          # load every extension once, print ok or failed
agentage extension check --json   # { machine, profile, extensions: [...] } on stdout
```

Loads every extension this machine can run once, the way `setup` does, rewrites
`state/<id>.json` for each and prints the rows: `state` is `ok` or `failed` (with the extension's
message) for what it loaded, `blocked` for a dependent of a failed extension, and the static
state for the rest. What an extension prints while loading goes to stderr, so `--json` stays
valid JSON. Exits 1 when any extension failed, `profile.json` is invalid, or on integrity drift.

## Extension commands

Needs `AGENTAGE_EXTENSIONS=1`.

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

With `AGENTAGE_EXTENSIONS=1`, `setup`, `extension install`, `extension remove` and `extension check`
also exit 1 when an extension failed to load or on integrity drift, an extension command exits 1
when its extension cannot load, and `setup --check` exits 1 when the machine is not converged.

Errors go to stderr; stdout carries only command output (`status --json` stays parseable).

## Environment

| Variable                  | Purpose                                                                           | Default                  |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `AGENTAGE_SITE_FQDN`      | Target host                                                                       | `agentage.io`            |
| `AGENTAGE_CONFIG_DIR`     | Config and credentials directory (`auth.json`)                                    | `~/.agentage`            |
| `AGENTAGE_TOKEN`          | Personal access token for CI and headless machines                                | unset                    |
| `NO_COLOR`                | Disable colored output (any non-empty value)                                      | unset                    |
| `AGENTAGE_EXTENSIONS`     | `1` enables `setup --profile`, loading, the `extension` group, extension commands | unset                    |
| `AGENTAGE_EXTENSIONS_DIR` | Extensions directory (trees, lock, `current`)                                     | `~/.agentage/extensions` |
