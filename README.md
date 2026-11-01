# @agentage/cli

![Connect this machine to agentage from the terminal](https://github.com/agentage/cli/raw/master/docs/banner.svg)

Connect this machine to your [agentage](https://agentage.io) account from the terminal. One
command signs you in through your browser, and from then on the machine is known to your account.

## What is this?

agentage gives your AI tools a shared, account-backed home. Every machine you use needs to be
connected to that account once: this package does that connection. It keeps your sign-in on
the machine (OAuth 2.1 with PKCE, nothing typed into the terminal), tells you whether the
machine is connected, and keeps itself up to date.

It is intentionally **small**: sign-in, status and update. Everything else arrives as modules
that the CLI installs for you.

## Get started

Needs Node.js 22 or newer.

```bash
npm install -g @agentage/cli
agentage setup
```

`setup` opens your browser, you sign in, and the session is stored in `~/.agentage`. Then:

```bash
agentage status
```

### On a server or in CI (no browser)

```bash
agentage setup --no-browser        # prints the sign-in URL to open elsewhere
AGENTAGE_TOKEN=aga_... agentage status   # or use a personal access token
```

### Then

- `agentage status --json` in scripts to check the machine is connected.
- `agentage update` whenever a newer version is published; `status` tells you when.

## Commands

| Command                       | What it does                                                            |
| ----------------------------- | ----------------------------------------------------------------------- |
| `agentage setup`              | Sign in through your browser, then show status                          |
| `agentage setup --no-browser` | Print the sign-in URL instead of opening a browser                      |
| `agentage setup --reauth`     | Force a fresh sign-in                                                   |
| `agentage setup --disconnect` | Sign out and remove local credentials                                   |
| `agentage status`             | Version, update, target, sign-in state, endpoint (`--json` for scripts) |
| `agentage update`             | Install the latest published version (`--check` only reports)           |

Flags, exit codes and token auth are in [`docs/reference.md`](docs/reference.md).

## Modules

A module is an npm package that adds to the CLI, for example new commands. The modules a machine
uses are named in a profile, and the CLI installs them with npm. Module support is experimental
and off unless you set `AGENTAGE_MODULES=1`; without it the CLI behaves exactly as described above.

```bash
export AGENTAGE_MODULES=1
agentage setup --profile ./profile.json            # install the modules a profile names, no sign-in
agentage setup --profile ./profile.json --dry-run  # show what would be installed, write nothing
agentage module list                               # one row per module: state, version, commands
agentage status                                    # adds this machine, the profile and a module count
```

A profile is a JSON file that maps package names to version ranges:

```json
{ "version": 1, "modules": { "@agentage/example": "^1.0.0" } }
```

Only `@agentage` packages are installed, and npm runs with `--ignore-scripts`. Everything lives in
the config directory:

| Path                       | What                                                |
| -------------------------- | --------------------------------------------------- |
| `~/.agentage/profile.json` | the profile `setup` installs from                   |
| `~/.agentage/machine.json` | this machine's id and name                          |
| `~/.agentage/modules/`     | installed modules; `modules/current` names the tree |

Details, including every state a module can be in, are in [`docs/reference.md`](docs/reference.md).

## How it works

This is the **terminal client for an agentage account**. `setup` registers a one-off OAuth
client, opens the authorization page in your browser and waits on a localhost callback; the
tokens land in `~/.agentage/auth.json` with owner-only permissions and are refreshed
automatically. `status` validates the session against the account's introspection endpoint
and reports version, update, target host and connectivity. Nothing runs in the background, and
nothing is installed beyond this package unless you turn modules on.

## Configuration

| Env                   | Default       | Purpose                                            |
| --------------------- | ------------- | -------------------------------------------------- |
| `AGENTAGE_SITE_FQDN`  | `agentage.io` | Target host                                        |
| `AGENTAGE_CONFIG_DIR` | `~/.agentage` | Config and credentials directory                   |
| `AGENTAGE_TOKEN`      | -             | Personal access token for CI and headless machines |
| `AGENTAGE_MODULES`    | -             | `1` turns on module support (experimental)         |
| `NO_COLOR`            | -             | Disable colored output                             |

## Develop

```bash
npm ci
npm run verify
npm run build && npm run test:e2e -- --grep @offline
```

## Release

Releases publish to npm via GitHub Actions when a `chore(release): X.Y.Z` commit that touches
`package.json` lands on `master` (the squash-merge subject of a release PR). The workflow skips
any version already on npm.

## License

MIT - see [LICENSE](./LICENSE).
