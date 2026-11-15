# @agentage/cli

![Connect this machine to agentage from the terminal](https://github.com/agentage/cli/raw/master/docs/banner.svg)

The agentage CLI connects each machine you use to your agentage account, a shared place for your
AI tools. Use it from a terminal, a server or CI. It also installs extensions: npm packages that
add commands to `agentage`. You need Node.js 22 or newer.

```bash
npm install -g @agentage/cli && agentage setup
```

## What is this?

The CLI stays **small**: sign-in, status, update and an extension manager. Sign-in uses OAuth 2.1
with PKCE: you type nothing into the terminal. Everything else, memory included, arrives as an
extension.

## Get started

`agentage setup` opens your browser for sign-in. Check the session with `agentage status`.
Installing and running extensions needs no sign-in. On a new machine, a signed-in `setup` installs
the extensions of your account's profile once; after that each machine keeps its own list.

### On a server or in CI (no browser)

`agentage setup --no-browser` prints the sign-in URL. Open it in a browser on this same machine,
because sign-in returns to `localhost`. On a server, use a personal access token from the
dashboard (**Settings -> API tokens**):

```bash
AGENTAGE_TOKEN=aga_... agentage status
```

More: [docs/reference.md](docs/reference.md#token-auth-ci-and-headless).

## Commands

| Command                       | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `agentage setup`              | Sign in, install your account's profile, show status, start the daemon        |
| `agentage setup --no-browser` | Print the sign-in URL instead of opening a browser                            |
| `agentage setup --reauth`     | Force a fresh sign-in                                                         |
| `agentage setup --disconnect` | Sign out and remove local credentials                                         |
| `agentage status`             | Version, update, target, sign-in, endpoint, then machine, profile, extensions |
| `agentage update`             | Install the latest published version (`--check` only reports)                 |
| `agentage daemon status`      | The local daemon on 127.0.0.1:4243 (`stop`, `restart`); `setup` starts it     |
| `agentage extension ...`      | Manage extensions, see [Extensions](#extensions)                              |
| any command with `--json`     | One JSON object on stdout: `{ success, data }` or `{ success, error }`        |

More: [author commands](docs/extensions.md#author-commands) and [the lifecycle](docs/extensions.md#lifecycle).

## Extensions

- A **profile** lists what your account wants: extensions, version ranges, and which are off
  per machine.
- On a new machine, `setup` installs the profile's extensions through the daemon, once. No
  command pushes your changes back to the account: each machine keeps its own list.
- `extension install`, `list`, `update`, `disable`, `enable`, `configure` and `remove` manage
  one extension in the local daemon (`127.0.0.1:4243`), which runs each as its own process.
- Nothing installs on a timer: the machine changes only when you run a command.

```bash
agentage extension install probe                    # the market's newest version, then it runs
agentage extension configure probe echo.prefix=hey  # settings, no daemon restart
agentage extension list                             # id, version, source, state
agentage probe ping                                 # run a command by its extension id
agentage extension remove probe                     # take it out again; --purge also deletes its data
```

Extensions run in the CLI process with your privileges, so install only ones you trust. npm runs with
`--ignore-scripts`. The account token leaves the environment before extension code loads.

More: [docs/profiles.md](docs/profiles.md).

### Write and run your own extension

`create` needs git and network. `build` and `up` also need
Docker; `release` needs the `gh` CLI.

```bash
agentage extension create example api   # makes ./extension-example with the api part
cd extension-example && npm ci          # installs the pinned cli
git init -q && git add -A && git commit -qm init   # up needs one commit
npx agentage extension up               # runs it with Docker
npx agentage extension token --scope example:read   # prints a dev token with that scope
npx agentage extension down             # removes what up started
```

In the extension folder, use `npx agentage`: the project's pinned cli and the global one can differ.

More: [docs/extensions.md](docs/extensions.md#run-it-locally).

## Where things live

Everything lives in the config directory, `~/.agentage` by default:

| Path                        | What                                                |
| --------------------------- | --------------------------------------------------- |
| `~/.agentage/auth.json`     | your sign-in, owner-only                            |
| `~/.agentage/profile.json`  | the profile: what this account wants                |
| `~/.agentage/machine.json`  | this machine's id, name, dev extensions and account |
| `~/.agentage/extensions/`   | installed extensions; `current` names the live tree |
| `~/.agentage/state/`        | the last run of each extension                      |
| `~/.agentage/commands.json` | which extension holds each top-level command        |
| `~/.agentage/secrets.json`  | extension secrets, owner-only                       |
| `~/.agentage/data/<id>/`    | what each extension keeps                           |

`status` writes `machine.json` even before you sign in.

To uninstall, run `agentage setup --disconnect`, then `npm uninstall -g @agentage/cli`, then
delete `~/.agentage`.

## How it works

- `setup` registers a one-off OAuth client and waits for the browser on a localhost callback.
- Tokens land in `~/.agentage/auth.json` (owner-only) and refresh automatically.
- `status` checks the session against the account's introspection endpoint.
- Nothing runs in the background.

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

Each e2e title under `e2e/core/` names a command and what must hold. The tests use a loopback
npm registry that serves `fixtures/`.

## Release

GitHub Actions publishes to npm when a release PR merges to `master` as a `chore(release): X.Y.Z`
commit that touches `package.json`. It skips a version already on npm.

## Documentation

- [docs/reference.md](docs/reference.md): every flag, exit code and environment variable.
- [docs/profiles.md](docs/profiles.md): profiles, extension states, the plan and updates.
- [docs/extensions.md](docs/extensions.md): write, check and run your own extension.

## License

MIT - see [LICENSE](./LICENSE).
