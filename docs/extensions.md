# Writing an extension

An extension is an npm package that adds to the `agentage` CLI, for example new commands. This
page is for people who write them. Extensions are part of every `agentage` install; there is
nothing to turn on. Flags and exit codes are in [`reference.md`](reference.md).

## Two shapes

- **`register(ctx)`**: an entry that exports `register(ctx)`. Described below.
- **Kit-shaped**: `agentage.parts` in `package.json`, built with `@agentage/extension`, created by
  `agentage extension create <id> [part...]`. The CLI never loads it with `register`; see "Built on the extension kit".

`extension create`, `check`, `build`, `up`, `down`, `token` and `release` serve kit-shaped packages. `extension
install`, `list` and `remove` act on the daemon's list of this machine, for both shapes.

## What an extension is

A package with an `agentage` block in `package.json` and an entry that exports `register(ctx)`.
This is `fixtures/extension-hello`, a working example:

```json
{
  "name": "@agentage/fixture-hello",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "license": "MIT",
  "agentage": {
    "id": "hello",
    "contributes": {
      "commands": ["hello"]
    },
    "configuration": {
      "greeting": {
        "type": "string",
        "default": "hello",
        "scope": "shared"
      }
    }
  }
}
```

```js
// @ts-check

/** @import { ExtensionContext } from '@agentage/cli/extension' */

/** @param {ExtensionContext} ctx */
export const register = async (ctx) => {
  const greet = () => `${ctx.config['greeting']} from ${ctx.id}`;
  // What it sees of the environment: the core removes AGENTAGE_TOKEN before loading.
  ctx.log('registered', { greeting: greet(), token: 'AGENTAGE_TOKEN' in process.env });
  ctx.commands.add((program) =>
    program
      .command('hello')
      .description('Print the greeting')
      .action(() => console.log(greet()))
  );
  return { greet };
};
```

| Field                           | Meaning                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `name`                          | The package name. The profile must name the same package.  |
| `exports` or `main`             | The entry. `exports` wins when present. It must exist.     |
| `agentage.id`                   | The extension id: `[a-z][a-z0-9-]*`. Unique. Not reserved. |
| `agentage.contributes.commands` | Every command name the extension may add.                  |
| `agentage.configuration`        | Settings the profile can fill in. See Configuration.       |
| `engines.agentage`              | Extension API range. Default `^1`. The API is `1.0.0`.     |
| `peerDependencies`              | Other extensions this one needs. See Peers and load order. |
| `peerDependenciesMeta`          | Mark a peer `optional`.                                    |

The core reads these fields as data and never imports the entry to check them. Ids that equal a
core command (`setup`, `status`, `update`, `extension`, `add`, `remove`, `help`) or a Windows
device name are reserved. For types, import from `@agentage/cli/extension`; it is type-only at
runtime, and `defineExtension` is an identity helper.

## Lifecycle

The daemon installs and runs extensions. A profile installs a set of them through the daemon:

```bash
agentage setup --profile ./profile.json   # install a whole profile, then load each once
agentage extension install <id>           # the market's newest version, then it runs
agentage extension update                 # move each market extension to its newest version
agentage extension remove <id>            # stop it; its data stays unless --purge
agentage extension list                   # the daemon's rows: id, version, source, state
agentage extension doctor                 # load everything once, refresh the run state
```

The install rules (market, npm names, versions, local folders) and every flag are in
[`reference.md`](reference.md#extension-lifecycle).

A profile maps package names to version ranges: `{ "version": 1, "extensions": { "<pkg>": "^1" } }`.

Static states are known without running code. They show in `extension doctor` and `setup`.

| State       | What makes it                                                                   |
| ----------- | ------------------------------------------------------------------------------- |
| `installed` | Valid manifest, present, not off on this machine, all required peers installed. |
| `off`       | In this machine's `off` list (only before `installation.json` exists).          |
| `blocked`   | A required peer is off, invalid, missing or blocked, or not in the profile.     |
| `invalid`   | Bad manifest, entry not found, wrong config type, duplicate id, peer cycle.     |
| `missing`   | Named in the profile but not in the installed tree.                             |

Run states come from a load. `extension doctor` and `setup` show them.

| State    | What makes it                                                                        |
| -------- | ------------------------------------------------------------------------------------ |
| `ok`     | The entry imported and `register` finished in time.                                  |
| `failed` | The import or `register` threw, rejected, exported no `register`, or took over 10 s. |

A failed load shows the extension's own message (`"timeout"` for the time limit). Its context is
revoked, its subscriptions are disposed, and none of its commands are kept. Other extensions still
load. Dependents of a failed extension are `blocked`. The last run is kept in `state/<id>.json`.
`setup` and `extension doctor` exit 1 when any extension failed.

Extensions run in the CLI process with the user's privileges. This is not a sandbox. The CLI
removes `AGENTAGE_TOKEN` from the environment before the first import, and what an extension
prints while loading goes to stderr. npm runs with `--ignore-scripts` at install.

## The `ctx` object

`register(ctx)` gets one frozen `ctx`. It is the only surface the core gives you.

| Member            | Type                                | Meaning                                 |
| ----------------- | ----------------------------------- | --------------------------------------- |
| `id`              | `string`                            | The `agentage.id`.                      |
| `version`         | `string`                            | The package version.                    |
| `previousVersion` | `string \| null`                    | Last version that loaded ok here.       |
| `mode`            | `'installed' \| 'dev' \| 'test'`    | `'dev'` for a local development path.   |
| `config`          | `Readonly<Record<string, unknown>>` | Settings, defaults filled, no secrets.  |
| `secrets`         | `{ get, set, delete }` (async)      | Per-machine secret values.              |
| `data`            | `string`                            | Path of the durable data directory.     |
| `cache`           | `string`                            | Path of the disposable cache directory. |
| `log`             | `(message, fields?) => void`        | Append one line to the extension's log. |
| `commands`        | `{ add(...registrars) }`            | Add CLI commands.                       |
| `use`             | `(id, { optional? }) => api`        | Call a peer extension.                  |
| `subscriptions`   | `{ push(...disposables) }`          | Things to dispose on exit.              |

`register` may return a plain object of functions for dependents, or nothing. It may be async.
After a failed or timed-out load, every `ctx` method throws.

`ctx.previousVersion` is the `version` of the last load that ended `ok` on this machine (`lastOk`
in `state/<id>.json`), `null` the first time. Compare it with `ctx.version` to migrate your data
once after an update, for example after `agentage extension update`. A failed load does not change
it.

### Configuration

Each entry in `agentage.configuration` has:

- `type`: `string`, `number`, `boolean`, `array` or `object`.
- `default`: used when the profile gives no value.
- `secret`: `true` keeps the value out of the profile. See Secrets.
- `scope`: `shared` or `machine`, declared in the manifest.

Values come from the profile: `config.<id>` is shared, and `machines.<machine id>.config.<id>`
overrides it per key on one machine. Defaults are filled in before `register` runs. A value of
the wrong type makes the extension `invalid`, with the key in the reason. Keys you did not
declare are passed through. Secret keys never enter `ctx.config`.

### Secrets

`ctx.secrets.get(key)`, `set(key, value)` and `delete(key)` use `secrets.json` in the config
directory, keyed by extension id (mode 0600, never synced). A user sets one with
`agentage extension configure <id> <key> --secret` (the value from stdin, or asked without echo
on a terminal); `setup` neither asks for nor lists missing secrets.

### Data and cache

`ctx.data` is `<config dir>/data/<id>` and `ctx.cache` is `<config dir>/cache/<id>`. The paths are
given. The CLI does not create the directories, so create them (`mkdir` with `recursive`).

### Log

`ctx.log('message', { any: 'fields' })` appends one JSON line with an `at` timestamp to
`logs/<id>.log` (mode 0600). When the file passes 1 MB the newest half is kept. The core never
reads it.

### Commands

```js
ctx.commands.add((program) => program.command('hello').action(() => console.log('hi')));
```

`program` is a Commander `Command`. Names must be `<id>` or `<id>:<name>` and be listed in
`agentage.contributes.commands`; any other name fails `register`. The CLI shows a stub for each
listed command from the manifest alone. Running `agentage <name>` loads only that extension and
its peers, and hands it the whole command line, `--help` included.

### Using a peer

```js
const hello = ctx.use('hello'); // throws if it is not a loaded peer
const maybe = ctx.use('hello', { optional: true }); // undefined if it is not
```

`use(id)` returns a frozen object of the functions the peer's `register` returned, bound to the
original. Other members are dropped. The peer must be in your `peerDependencies`.

### Subscriptions

`ctx.subscriptions.push({ dispose })` registers cleanup. `dispose` may be async. When the process
ends, or on SIGINT or SIGTERM, each one gets 5 seconds; one that hangs is abandoned. Results are
written to your log.

## Peers and load order

List other extensions in `peerDependencies` (by package name). Peers load first. A required peer
that is off, invalid, missing or failed makes the dependent `blocked`, and the reason names the
peer. Mark a peer optional in `peerDependenciesMeta`:

```json
{ "peerDependenciesMeta": { "@acme/other": { "optional": true } } }
```

An optional peer still loads first when present, but its absence does not block you. A peer cycle
makes every extension in it `invalid`. A peer that is a plain library, with no `agentage` block,
is ignored.

## Where things live

Under `~/.agentage/`, or `AGENTAGE_CONFIG_DIR` when set:

| Path                | What                                                  |
| ------------------- | ----------------------------------------------------- |
| `installation.json` | This machine's extension list, written by the daemon. |
| `profile.json`      | The profile: extensions, registries, config.          |
| `machine.json`      | This machine's id, name and development paths.        |
| `extensions/`       | Installed trees, one per id and version.              |
| `state/<id>.json`   | The last load, written by the CLI.                    |
| `secrets.json`      | Secrets per extension id.                             |
| `data/<id>/`        | `ctx.data`.                                           |
| `cache/<id>/`       | `ctx.cache`.                                          |
| `logs/<id>.log`     | `ctx.log`.                                            |

## Developing locally

Install a folder as a development extension:

```bash
agentage extension install ./my-extension   # needs package.json with name and agentage.id
agentage extension list                     # check the state and reason
agentage extension doctor                   # load it, see ok or failed
agentage extension remove <id>              # stop using it
```

The daemon runs the folder in place by its real path, with no copy, and `ctx.mode` is `'dev'`.
A folder that another user can write to is refused. The profile is not changed.

`extension remove <id> [--purge] [--yes]` stops the extension and forgets its settings and
secrets. It refuses while another installed extension peer-depends on it, and names the
dependents (`--force` removes it anyway). `--purge` also deletes `data/<id>/`. It asks first on a
terminal; without one it needs `--yes`.

To publish, use any npm-compatible registry. The profile's `registries` maps an npm scope to a
registry URL; other packages come from the public npm registry.

## Before you publish

1. `agentage.id` is lowercase, unique, and not a core command name.
2. `name` in `package.json` is the name users put in their profile.
3. The entry (`exports` or `main`) exists in the published package and exports `register`.
4. `engines.agentage` matches the extension API (`^1`). Raise it only with a new major of your
   package: `setup --profile` and an install resolved on npm skip a version whose range the
   user's CLI does not satisfy.
5. Every command is in `contributes.commands` and named `<id>` or `<id>:<name>`.
6. Every setting has a `type`; secrets are marked `secret: true` and read from `ctx.secrets`.
7. Other extensions you call are in `peerDependencies` (optional ones marked).
8. `register` finishes well inside 10 seconds; slow work waits for a command.
9. Anything that needs cleanup is pushed to `ctx.subscriptions`.
10. `agentage extension doctor` shows `ok`, and nothing in your code reads `AGENTAGE_TOKEN`.

## Built on the extension kit

A package whose `agentage` block has `parts` is built on the extension kit
(`@agentage/extension`) instead of this API: its `engines.agentage` ranges over the kit's
version, its commands are `agentage.commands[].name` with a `summary` each, and its command entry
is `parts.cli.entry`, else `./dist/cli/index.js`, exporting `create(ctx)`. The CLI never imports
it to load it: `extension doctor` asks the kit whether the entry exports `create` and its
handlers are the declared commands, and running `agentage <command>` or `agentage <id> <command>`
hands the rest of the command line to the kit, which parses the args and runs the handler. The
kit's own documentation covers writing one; `agentage extension install .` links your working
copy, `agentage extension up` runs it on the daemon and reloads each saved change, and
`up --docker` runs the whole package on Docker.

## Author commands

| Command                                                     | What it does                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `agentage extension create <id> [part...]`                  | New `./extension-<id>`, built and installed in the daemon (`--no-install`)                         |
| `agentage extension check [dir] [--write]`                  | Check that an extension package conforms (the six kit rules)                                       |
| `agentage extension build [--docker\|--container] [--push]` | Build the package (no Docker); `--docker`: part images; `--container`: one image; `--push`: pushed |
| `agentage extension release`                                | Release from a tag in CI: guard, part images, one image, records, npm package                      |
| `agentage extension up [--docker]` / `down`                 | Run the working copy on the daemon, reload each change (`--docker`: on Docker); `down` removes it  |
| `agentage extension token --scope <scope> [--dir <path>]`   | Print a token from the dev issuer `extension up` started for that folder                           |

## Run it locally

`extension create <id> [part...]` makes `./extension-<id>` from the template. A part is one piece
of an extension: `pages`, `ui`, `api`, `mcp`, `worker`, `cli`, `app` or `store`. With fewer than eight
parts, `create` sets `MIN_EXECUTED` to 1. `MIN_EXECUTED` is the least number of e2e tests that CI
must run. After the first green run, set it to the real count. When `create` cannot find that
line, it says so and you set it by hand.

The template is the folder `template/` of the kit repo (`agentage/platform:template`); only that
folder is copied, with no history. `--from <owner/repo>` takes another template repo at its root
(`agentage/extension-template` is the old template), `--from <owner/repo#branch>` one of its
branches, and `:folder` after either one folder of it. For any source other than the kit's
`template` folder or `agentage/extension-template`, `create` first prints
that code from that repo will be built and run on this machine, and asks `run it? (y/N)`; with
`--yes` it does not ask, and with no terminal (or `--json`) it needs `--yes`. After the clone,
`create` runs `npm ci --ignore-scripts`, builds the package (as `extension build` does) and gives
the folder to the daemon (`agentage extension install <folder>`). `--no-install` only scaffolds:
the clone, the rename and the parts dropped, no npm and no build. `create` adds `.agentage/` to the
folder's `.gitignore` when it is missing, and says so. It ends
with `url       <the first public route of the api that answers>`.

1. Install git and npm for `create`, which clones the kit repo from GitHub. `build --container`,
   `build --push`, `up --docker` and `release` also need Docker and a committed tree.
2. Inside the extension folder, run `npx agentage extension up`. Use `npx agentage`, not the
   global `agentage`, which can be older than the version the project pins. It builds the
   package, runs it on the daemon (`127.0.0.1:4243/api/<id>/`) and prints the URL. Each saved
   change under `src/` is built into `dist.next/` and reloaded; a build error or a build that
   does not start keeps the last good build. Ctrl-C stops the watch; `npx agentage extension
down` in the folder removes the row (its data stays).
3. `npx agentage extension up --docker` runs every part on Docker. It needs ports 4280 (gateway)
   and 4281 (token issuer) free; when another working copy holds them, it refuses and names its
   compose project.
4. `npx agentage extension token --scope <id>:read` prints a token from the Docker stack of this
   folder. It needs Docker unless `--issuer` is given.
5. `npx agentage extension down` stops the watch, removes the row `up` added, and removes the Docker stack
   (containers, network, store volume) of this folder.
