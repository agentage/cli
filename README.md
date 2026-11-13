# @agentage/cli

![Connect this machine to agentage from the terminal](https://github.com/agentage/cli/raw/master/docs/banner.svg)

```bash
npm install -g @agentage/cli && agentage setup
```

## What is this?

agentage gives your AI tools a shared place that belongs to your account. This package connects
each machine you use to that account. It keeps your sign-in on the machine (OAuth 2.1 with PKCE,
nothing typed into the terminal), tells you whether the machine is connected, and keeps itself
up to date.

The CLI stays **small**: sign-in, status, update, and an extension manager. Everything else,
memory included, arrives as an extension the CLI installs for you.

## Get started

Needs Node.js 22 or newer. Install, list, run and remove need nothing else. For your own
extensions, `create` needs git and network. `build` and `up` need Docker and git, and `release` also
needs the `gh` CLI (see [Write and run your own extension](#write-and-run-your-own-extension)).

```bash
npm install -g @agentage/cli
agentage setup
```

`setup` opens your browser, you sign in, and the session is stored in `~/.agentage`. Check it
with `agentage status`.

You can skip `setup` if you only want extensions: installing, listing, running and removing them
needs no sign-in, so `agentage extension install probe` works without one. Sign-in adds your
account's profile and the same extensions on every machine.

### On a server or in CI (no browser)

```bash
agentage setup --no-browser              # prints the sign-in URL instead of opening a browser
AGENTAGE_TOKEN=aga_... agentage status   # or use a personal access token
```

The sign-in URL sends the browser back to `http://localhost:<port>/callback` on this machine, so
open it in a browser on this machine. On a server, use a personal access token instead. Create one
in the dashboard under **Settings -> API tokens**. Plain `setup` does not sign in with `AGENTAGE_TOKEN`. Its account step and its status step use it.

## Commands

| Command                       | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `agentage setup`              | Sign in through your browser, install your account's profile, show status     |
| `agentage setup --no-browser` | Print the sign-in URL instead of opening a browser                            |
| `agentage setup --reauth`     | Force a fresh sign-in                                                         |
| `agentage setup --disconnect` | Sign out and remove local credentials                                         |
| `agentage status`             | Version, update, target, sign-in, endpoint, then machine, profile, extensions |
| `agentage update`             | Install the latest published version (`--check` only reports)                 |

For extensions (see below):

| Command                                      | What it does                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `agentage setup --profile <file>`            | Install and load the extensions a profile file names, no sign-in |
| `agentage setup --profile <file> --dry-run`  | Show what would be installed, write nothing                      |
| `agentage setup --latest`                    | Update each extension to the newest version its range allows     |
| `agentage extension install <name> [--off]`  | Add an extension to the profile, install and load it             |
| `agentage extension remove <name> [--purge]` | Take it out of the profile and reinstall the rest                |
| `agentage extension list`                    | One row per extension: state, version, commands, last run        |
| `agentage extension doctor`                  | Load every extension once and refresh the states                 |
| `agentage extension create <id> [part...]`   | New `./extension-<id>` from the template, only the parts named   |
| `agentage extension check [dir] [--write]`   | Check that an extension package conforms (the six kit rules)     |
| `agentage extension build [--push]`          | Build the part images of a committed tree; push with digests     |
| `agentage extension release`                 | Release from a tag in CI: guard, images, record, npm package     |
| `agentage extension up` / `down`             | Run an extension package on this machine with Docker, then stop  |
| `agentage extension token --scope <scope>`   | Print a token from the dev issuer `extension up` started         |
| `agentage <command>`                         | Run a command an installed extension contributes                 |
| `agentage <id> <command>`                    | The same for an extension built on the kit; always works         |

Flags, exit codes and token auth are in [`docs/reference.md`](docs/reference.md).

## Extensions

An extension is an npm package that adds commands to the CLI. Extensions are on by default. A
machine whose profile names no extensions has none.

- A **profile** says what your account wants: which extensions, at which version ranges, and which
  ones are switched off on which machine.
- The CLI brings the machine to that state. `setup` installs what the profile names, loads each
  extension once and prints whether it loaded (`ok`) or why not.
- `extension install` and `extension remove` edit the profile and then do the same.
- Nothing installs itself on a timer. The state changes only when you run a command.

Signed in, `setup` reads the profile your account holds, so every machine you set up gets the same
extensions. `extension install` and `extension remove` save the change there. When your account
has no profile, `setup` says so on one line and carries on. Each machine you run `setup` on
appears in your account as one of its machines.

Use `agentage extension install probe` for a short name: it means `@agentage/extension-probe`,
else `agentage-extension-probe`. With a bare name, the command asks the market (the extension
directory of the site) for the newest version. When the market does not answer, it prints
`market unavailable, versions not checked` and installs through npm. That line is harmless.

To run extension commands, use `agentage <command>` or `agentage <id> <command>`. Install is
idempotent: a second install of the same extension prints `added` again and changes nothing.

```bash
agentage setup --check                             # exit 1 when this machine differs from its profile
agentage extension install example                 # short name for @agentage/extension-example
agentage extension install ./my-extension          # a local folder, for development
agentage extension install .                       # link the working copy you are in
agentage extension remove example                  # take it out again
agentage ping                                      # a command an installed extension contributes
agentage probe ping                                # the same, by its extension id
```

An extension built on the extension kit (the `@agentage/extension` library) lists its commands in
its manifest. Each runs as `agentage <command>` and always as `agentage <id> <command>`. When the
name is a core command, an extension id or a command an earlier install took, only
`agentage <id> <command>` runs it, and the install says so.

`extension list` shows one state per extension:

| State       | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `installed` | in the installed tree and ready to load                              |
| `off`       | installed, but this machine's profile entry turns it off             |
| `blocked`   | an extension it needs is not `installed`                             |
| `invalid`   | its manifest, config, integrity or dev folder is wrong; never loaded |
| `missing`   | the profile names it but the tree does not hold it                   |

`last run: ok` is the result of the last load, not the state.

The plan is what `setup` would change, one line per extension (`+ add`, `~ update`, `- remove`,
`o off`) and a summary such as `plan: 1 to add, 0 to update, 0 to remove, 0 off, 2 unchanged`.
`setup --dry-run` prints it, `setup --check` exits 1 when anything would change, `extension list`
shows it per extension and `status` sums it up, for example `extensions 2 (1 to add)`.

`setup --latest` moves each extension to the newest version its range allows and prints one line
per change, such as `~ update @agentage/example 1.0.0 -> 1.0.1`. The new versions take over only
after every extension loaded from them cleanly; until then the installed ones stay. A version
that needs a newer extension API than this CLI has is skipped, here and by `extension install`.

A profile is a JSON file that maps package names to version ranges. `registries` is optional.
It routes a scope to another npm-compatible registry. Everything else comes from npm's public
registry.

```json
{
  "version": 1,
  "extensions": { "@agentage/example": "^1.0.0" },
  "registries": { "@acme": "https://npm.acme.example" }
}
```

Extensions run in the CLI process with your privileges, so install only extensions you trust.
npm runs with `--ignore-scripts`. The account token is removed from the environment before any
extension code loads.

### Write and run your own extension

`extension create <id> [part...]` makes `./extension-<id>` from the template. A part is one piece
of an extension: `pages`, `ui`, `api`, `mcp`, `worker`, `cli` or `store`.

1. Install git for `create`, which clones the template from GitHub. `build`, `up` and `release` also
   need Docker. `build` needs a committed, clean tree. `up` needs one commit.
2. Inside the extension folder, run `npx agentage extension up`. Use `npx agentage`, not the
   global `agentage`: the global one can be older than the version the project pins and lack
   the command.
3. `up` needs ports 4280 (gateway) and 4281 (token issuer) free. When another working copy holds
   them, `up` refuses and names its compose project. Run `npx agentage extension down` in that
   folder, or find it with `docker ps`.
4. `npx agentage extension token --scope <id>:read` prints a token. Run `up` first: `token` only
   asks localhost:4281 and returns a token from whichever stack holds it.
5. Run `npx agentage extension down` to remove the containers, network and store volume.

## Where things live

Everything the CLI keeps is in the config directory, `~/.agentage` by default:

| Path                        | What                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `~/.agentage/auth.json`     | your sign-in, owner-only                                                                       |
| `~/.agentage/profile.json`  | the profile: what this account wants                                                           |
| `~/.agentage/machine.json`  | this machine's id, name, development extensions and account                                    |
| `~/.agentage/extensions/`   | installed extensions: `package.json`, the lock, `trees/<hash>/`; `current` names the live tree |
| `~/.agentage/state/`        | the last run of each extension                                                                 |
| `~/.agentage/commands.json` | which extension holds each top-level command                                                   |
| `~/.agentage/secrets.json`  | extension secrets, owner-only                                                                  |
| `~/.agentage/data/<id>/`    | what each extension keeps                                                                      |

`status` writes `machine.json` even before you sign in.

To uninstall: run `agentage setup --disconnect`, then `npm uninstall -g @agentage/cli`. The
uninstall leaves `~/.agentage`. Delete that folder to remove everything.

Every flag is in [`docs/reference.md`](docs/reference.md).
To write an extension, start with [`docs/extensions.md`](docs/extensions.md).

## How it works

This is the **terminal client for an agentage account**. `setup` registers a one-off OAuth
client, opens the authorization page in your browser and waits on a localhost callback; the
tokens land in `~/.agentage/auth.json` with owner-only permissions and are refreshed
automatically. `status` validates the session against the account's introspection endpoint
and reports version, update, target host and connectivity. Nothing runs in the background, and
nothing is installed beyond this package unless your profile names extensions.

## Configuration

| Env                       | Default               | Purpose                                            |
| ------------------------- | --------------------- | -------------------------------------------------- |
| `AGENTAGE_SITE_FQDN`      | `agentage.io`         | Target host                                        |
| `AGENTAGE_CONFIG_DIR`     | `~/.agentage`         | Config and credentials directory                   |
| `AGENTAGE_TOKEN`          | -                     | Personal access token for CI and headless machines |
| `AGENTAGE_EXTENSIONS_DIR` | `<config>/extensions` | Where extensions are installed                     |
| `NO_COLOR`                | -                     | Disable colored output                             |

## Develop

```bash
npm ci
npm run verify
npm run build && npm run test:e2e -- --grep @offline
```

The e2e specs under `e2e/core/` read as scenarios: each title names the command and what must
hold. They run against a loopback registry that serves the extensions under `fixtures/`.

## Release

Releases publish to npm via GitHub Actions when a `chore(release): X.Y.Z` commit that touches
`package.json` lands on `master` (the squash-merge subject of a release PR). The workflow skips
any version already on npm.

`agentage extension release` skips npm for a package with `"private": true`. It pushes the images, attaches the record and prints `PASS npm: private package, not published`.

## License

MIT - see [LICENSE](./LICENSE).
