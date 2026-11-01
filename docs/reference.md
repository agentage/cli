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
agentage setup --profile ./profile.json --dry-run  # print the install plan, write nothing
agentage setup                                     # sign in, then install and load profile.json
```

`--profile <file>` validates the file (schema v1), saves it as `profile.json` (mode 0600,
keeping this machine's own `machines[<id>]` entry), records `profileSource: "file"` in
`machine.json` and installs; it never signs in. Every version must be a semver range or an
`https:` tarball URL (`npm:`, `github:`, `file:`, `http:` and local paths are refused); a refused
profile names each entry and the rule and writes nothing. Plain `setup` signs in, then installs
from the local `profile.json`; with none it saves the built-in default profile (no extensions)
locally and says the cloud profile is unavailable. `--dry-run` prints the plan (registries,
install set, npm command, tree) and stops before npm; it never signs in. `--disconnect` skips the
extension steps.

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

Extensions run in the CLI process with your privileges: installing one is an act of trust.
What they keep, and what the CLI keeps about them, lives in the config directory:

| Path              | What                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `state/<id>.json` | the last load, written by the CLI: `{ at, pid, state, error }`           |
| `secrets.json`    | secrets per extension id (mode 0600, never synced)                       |
| `logs/<id>.log`   | the extension's own log, one JSON line per entry (0600, kept under 1 MB) |
| `data/<id>/`      | the extension's durable data (`ctx.data`), created by the extension      |
| `cache/<id>/`     | the extension's disposable cache (`ctx.cache`), created by the extension |

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
the same three keys after the existing ones:

| Line         | JSON key     | Meaning                                                                       |
| ------------ | ------------ | ----------------------------------------------------------------------------- |
| `machine`    | `machine`    | this machine's id and name from `machine.json` (created on first use)         |
| `profile`    | `profile`    | `version <n> (source: file or default)`, `no profile` or `invalid`            |
| `extensions` | `extensions` | how many extensions the profile and the dev paths name (a number in `--json`) |

Extension code is never loaded and the only file written is `machine.json`. With no profile it
prints `no profile` and exits 0; an invalid `profile.json` still prints the report, then
exits 1 naming each bad entry on stderr. The rows themselves are in `extension list`.

## extension list

Needs `AGENTAGE_EXTENSIONS=1`.

```bash
agentage extension list          # one row per extension
agentage extension list --json   # { machine, profile, extensions: [...] } on stdout
agentage extension               # the extension command help
```

One row per extension in the profile or a dev path, read from the installed tree, the profile
and the state files; extension code is never loaded and the only file written is `machine.json`.
An invalid `profile.json` still prints the rows, then exits 1.

| Column   | JSON field  | Meaning                                                          |
| -------- | ----------- | ---------------------------------------------------------------- |
| id       | `id`        | `agentage.id` from the extension's `package.json`                |
| state    | `state`     | `installed`, `off`, `blocked`, `invalid` or `missing`            |
| package  | `package`   | package name; `mode` is `dev` for a local path in `machine.json` |
| version  | `installed` | version found in the installed tree                              |
| wants    | `wanted`    | range or `https:` URL from the profile's `extensions`            |
| commands | `commands`  | `agentage.contributes.commands`                                  |
| last run | `lastRun`   | `state/<id>.json`: `at`, `state` (`ok` or `failed`), `error`     |
| reason   | `error`     | why the extension is `invalid`, `blocked` or `missing`           |

An extension is `off` when this machine's `machines[<id>].off` in the profile lists it, `blocked`
when an extension it peer-depends on is not `installed`, `invalid` when its manifest is wrong (a
duplicate `agentage.id`, an `engines.agentage` range the extension API does not satisfy, no entry
point, a contributed command not named after the id) or the profile's `config.<id>` holds a value of
the wrong type for a key the extension declares, and `missing` when it is not in the installed
tree. Declared defaults fill the keys the profile leaves out.

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
valid JSON. Exits 1 when any extension failed or `profile.json` is invalid.

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

With `AGENTAGE_EXTENSIONS=1`, `setup` and `extension check` also exit 1 when an extension failed to
load, and an extension command exits 1 when its extension cannot load.

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
