# @agentage/cli

![Connect this machine to agentage from the terminal](https://github.com/agentage/cli/raw/master/docs/banner.svg)

Connect this machine to your [agentage](https://agentage.io) account from the terminal. One
command signs you in through your browser, and from then on the machine is known to your account.

## What is this?

agentage gives your AI tools a shared, account-backed home. Every machine you use needs to be
connected to that account once: this package does that connection. It keeps your sign-in on
the machine (OAuth 2.1 with PKCE, nothing typed into the terminal), tells you whether the
machine is connected, and keeps itself up to date.

It is intentionally **small**: sign-in, status and update. Everything else arrives as extensions
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

## Extensions

An extension is an npm package that adds to the CLI, for example new commands. The extensions a
machine uses are named in a profile, and the CLI installs them with npm. Extension support is
experimental and off unless you set `AGENTAGE_EXTENSIONS=1`; without it the CLI behaves exactly
as described above.

```bash
export AGENTAGE_EXTENSIONS=1
agentage setup --profile ./profile.json            # install the extensions a profile names, no sign-in
agentage setup --profile ./profile.json --dry-run  # show what would be installed, write nothing
agentage extension install @agentage/example       # add one extension to profile.json, install and load it
agentage extension remove @agentage/example        # take it out again and reinstall the rest
agentage extension list                            # one row per extension: state, version, commands
agentage status                                    # adds this machine, the profile and an extension count
```

After installing, `setup` loads each extension once and prints whether it loaded (`ok`) or why
not, and the commands extensions contribute run as `agentage <command>`. Extensions run in the CLI
process with your privileges, so install only extensions you trust.

A profile is a JSON file that maps package names to version ranges:

```json
{ "version": 1, "extensions": { "@agentage/example": "^1.0.0" } }
```

Extensions are installed from npm's public registry unless the profile's `registries` names
another npm-compatible registry for their scope. npm runs with `--ignore-scripts`. Everything lives
in the config directory:

| Path                       | What                                                      |
| -------------------------- | --------------------------------------------------------- |
| `~/.agentage/profile.json` | the profile `setup` installs from                         |
| `~/.agentage/machine.json` | this machine's id, name and dev extensions                |
| `~/.agentage/extensions/`  | installed extensions; `extensions/current` names the tree |

Details, including every state an extension can be in, are in
[`docs/reference.md`](docs/reference.md).

To write one, see [`docs/extensions.md`](docs/extensions.md).

## How it works

This is the **terminal client for an agentage account**. `setup` registers a one-off OAuth
client, opens the authorization page in your browser and waits on a localhost callback; the
tokens land in `~/.agentage/auth.json` with owner-only permissions and are refreshed
automatically. `status` validates the session against the account's introspection endpoint
and reports version, update, target host and connectivity. Nothing runs in the background, and
nothing is installed beyond this package unless you turn extensions on.

## Configuration

| Env                   | Default       | Purpose                                            |
| --------------------- | ------------- | -------------------------------------------------- |
| `AGENTAGE_SITE_FQDN`  | `agentage.io` | Target host                                        |
| `AGENTAGE_CONFIG_DIR` | `~/.agentage` | Config and credentials directory                   |
| `AGENTAGE_TOKEN`      | -             | Personal access token for CI and headless machines |
| `AGENTAGE_EXTENSIONS` | -             | `1` turns on extension support (experimental)      |
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
