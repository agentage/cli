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
dashboard (**Settings**, then **API tokens**):

```bash
AGENTAGE_TOKEN=aga_... agentage status
```

More: [docs/reference.md](docs/reference.md#token-auth-ci-and-headless).

## Commands

| Command                       | What it does                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `agentage setup`              | Sign in, install your account's profile, show status, start the daemon             |
| `agentage setup --no-browser` | Print the sign-in URL instead of opening a browser                                 |
| `agentage setup --reauth`     | Force a fresh sign-in                                                              |
| `agentage setup --disconnect` | Sign out and remove local credentials                                              |
| `agentage status`             | Version, update, target, sign-in, endpoint, then machine, profile, extensions      |
| `agentage update`             | Install the latest published version (`--check` only reports)                      |
| `agentage daemon status`      | The local daemon on 127.0.0.1:4243 (`start`, `stop`, `restart`); `setup` starts it |
| `agentage extension ...`      | Manage extensions, see [Extensions](#extensions)                                   |
| any command with `--json`     | One JSON object on stdout: `{ success, data }` or `{ success, error }`             |

More: [author commands](docs/extensions.md#author-commands) and
[the lifecycle](docs/reference.md#extension-lifecycle).

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

Extensions run with your privileges, in the daemon and in the CLI process, so install only ones
you trust. npm runs with `--ignore-scripts`. The account token leaves the environment before
extension code loads.

More: [docs/profiles.md](docs/profiles.md).

### Write and run your own extension

`create` needs git and network. `build --container`, `up --docker` and `release` also need
Docker and a committed tree; `release` needs the `gh` CLI.

```bash
agentage extension create example api   # makes ./extension-example with the api part
cd extension-example && npm ci          # installs the pinned cli
npx agentage extension up               # runs it on the daemon, reloads each saved change
npx agentage extension down             # removes the row up added (its data stays)
```

In the extension folder, use `npx agentage`: the project's pinned cli and the global one can differ.

More: [docs/extensions.md](docs/extensions.md#run-it-locally).

## Where things live

Everything lives in the config directory, `~/.agentage` by default:

| Path                            | What                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `~/.agentage/auth.json`         | your sign-in, owner-only                              |
| `~/.agentage/profile.json`      | the profile: what this account wants                  |
| `~/.agentage/machine.json`      | this machine's id, name, dev extensions and account   |
| `~/.agentage/installation.json` | this machine's extension list, written by the daemon  |
| `~/.agentage/daemon.json`       | the running daemon: pid, port, host token; owner-only |
| `~/.agentage/extensions/`       | installed extensions, one tree per id and version     |
| `~/.agentage/state/`            | the last run of each extension                        |
| `~/.agentage/commands.json`     | cli 0.51's command holders; read, never written       |
| `~/.agentage/secrets.json`      | extension secrets, owner-only                         |
| `~/.agentage/data/<id>/`        | what each extension keeps                             |
| `~/.agentage/logs/`             | `daemon.log` and each extension's log                 |

`status` writes `machine.json` even before you sign in.

To uninstall, run `agentage setup --disconnect`, then `npm uninstall -g @agentage/cli`, then
delete `~/.agentage`.

## How it works

- `setup` registers a one-off OAuth client and waits for the browser on a localhost callback.
- Tokens land in `~/.agentage/auth.json` (owner-only) and refresh automatically.
- `status` checks the session against the account's introspection endpoint.
- The daemon is the only background process. It starts when a command needs it and runs until
  `agentage daemon stop`. Nothing installs on a timer.

## Configuration

| Env                       | Default               | Purpose                                            |
| ------------------------- | --------------------- | -------------------------------------------------- |
| `AGENTAGE_SITE_FQDN`      | `agentage.io`         | Target host                                        |
| `AGENTAGE_CONFIG_DIR`     | `~/.agentage`         | Config and credentials directory                   |
| `AGENTAGE_TOKEN`          | -                     | Personal access token for CI and headless machines |
| `AGENTAGE_EXTENSIONS_DIR` | `<config>/extensions` | Where extensions are installed                     |
| `AGENTAGE_DAEMON_PORT`    | `4243`                | The daemon's port on 127.0.0.1                     |
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

Dispatch `prepare-release.yml` (a weekly schedule also dispatches it). It opens a
`chore(release): X.Y.Z` PR and arms auto-merge. On the merge, `release.yml` runs verify and the
agentage/e2e cli tier on the packed cli, then publishes to npm with OIDC trusted publishing and
provenance, and pushes the tag `vX.Y.Z`. It skips a version already on npm.

- The publish worked but the tag push failed: push the tag by hand on the release commit
  (`git tag vX.Y.Z <release commit> && git push origin vX.Y.Z`); never publish again.
- The cli tier failed: fix the cli or the e2e test, then dispatch `release.yml` again.
- `release.yml` runs only the `@smoke` tests of the agentage/e2e cli tier on the candidate. The
  lifecycle, execution and reload tests of agentage/e2e run on its own PRs against the published
  cli.

## Documentation

- [docs/reference.md](docs/reference.md): every flag, exit code and environment variable.
- [docs/profiles.md](docs/profiles.md): profiles, extension states, the plan and updates.
- [docs/extensions.md](docs/extensions.md): write, check and run your own extension.

## License

MIT - see [LICENSE](./LICENSE).
