# Writing an extension

An extension is an npm package that adds to the `agentage` CLI, for example new commands. This
page is for people who write them. Extensions are part of every `agentage` install; there is
nothing to turn on. Flags and exit codes are in [`reference.md`](reference.md).

## Two shapes

- **`register(ctx)`**: an entry that exports `register(ctx)`. Described below.
- **Kit-shaped**: `agentage.parts` in `package.json`, built with `@agentage/extension`, created by
  `agentage extension create <id> [part...]`. The CLI never loads it with `register`; see "Built on the extension kit".

`extension create`, `check`, `build`, `up`, `down`, `token` and `release` serve kit-shaped packages. `extension
install`, `list` and `remove` act on the profile, for both shapes.

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

An extension is installed from a profile:

```bash
agentage setup --profile ./profile.json   # install a whole profile, then load each once
agentage setup --latest                   # move each extension to the newest version it allows
agentage extension install <name> [--off] # add one extension, install, load
agentage extension remove <name>          # drop one, then install and load the rest
agentage extension list                   # states, no extension code runs
agentage extension doctor                 # load everything once, refresh the run state
```

`extension install` takes a package name with an optional range (`@acme/example@~1.2`), an
`https:` tarball URL, or a bare id such as `example`. A bare id asks the market first: the
version is the market's `latest`, and a private entry has no npm package, so install refuses it.
A market answer with a bad version or another package's name fails the install. An id the market does not know, or with no market answering, is looked up on npm as
`@agentage/extension-example`, else `agentage-extension-example`. Other names without a range
pin `^` the newest published version whose `engines.agentage` the extension API satisfies, and
print a `skipped` line for each newer version that needs another API. It writes the profile, then
installs and loads like `setup`. `--off` installs the package but leaves it `off` on this
machine. A `./path` is a dev extension, see Developing locally.

A profile maps package names to version ranges: `{ "version": 1, "extensions": { "<pkg>": "^1" } }`.

Static states are known without running code. They show in `extension list` and `setup`.

| State       | What makes it                                                                   |
| ----------- | ------------------------------------------------------------------------------- |
| `installed` | Valid manifest, present, not off on this machine, all required peers installed. |
| `off`       | Set by `extension install --off`: in this machine's `off` list.                 |
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
once after an update, for example after `agentage setup --latest`. A failed load does not change
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
directory, keyed by extension id (mode 0600, never synced). `setup` asks for each missing secret
on a terminal, without echo, and elsewhere lists them as `secrets to set: <id>.<key>`.

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

| Path              | What                                                        |
| ----------------- | ----------------------------------------------------------- |
| `profile.json`    | The profile: extensions, registries, config.                |
| `machine.json`    | This machine's id, name and development paths.              |
| `extensions/`     | Installed trees; `extensions/current` names the one in use. |
| `state/<id>.json` | The last load, written by the CLI.                          |
| `secrets.json`    | Secrets per extension id.                                   |
| `data/<id>/`      | `ctx.data`.                                                 |
| `cache/<id>/`     | `ctx.cache`.                                                |
| `logs/<id>.log`   | `ctx.log`.                                                  |

## Developing locally

Install a folder as a development extension:

```bash
agentage extension install ./my-extension   # needs package.json with name and agentage.id
agentage extension list                     # check the state and reason
agentage extension doctor                   # load it, see ok or failed
agentage extension remove my-extension      # stop using it (name, short name or id)
```

The path is stored by its real path in the `dev` map of `machine.json`. The profile is not
changed. The folder replaces the installed copy of the same package on this machine, and
`ctx.mode` is `'dev'`. A dev extension always loads, so `--off` is refused for it. A dev folder
whose `package.json` is gone is `missing`.

`extension remove <name> [--purge] [--yes]` takes the package out of the profile, this machine's
`off` list and `dev` map, and deletes `state/<id>.json`. It refuses while another extension
peer-depends on it, and names the dependents. The logs, secrets and config stay. `--purge` also
deletes `data/<id>/`. It asks first on a terminal; without one it needs `--yes`.

To publish, use any npm-compatible registry. The profile's `registries` maps an npm scope to a
registry URL; other packages come from the public npm registry.

## Before you publish

1. `agentage.id` is lowercase, unique, and not a core command name.
2. `name` in `package.json` is the name users put in their profile.
3. The entry (`exports` or `main`) exists in the published package and exports `register`.
4. `engines.agentage` matches the extension API (`^1`). Raise it only with a new major of your
   package: `extension install` and `setup --latest` skip a version whose range the user's CLI
   does not satisfy, and keep the version they have.
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
copy, and `agentage extension up` runs the whole package on Docker.
