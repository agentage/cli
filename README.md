# @agentage/cli

![Connect this machine to agentage from the terminal](https://github.com/agentage/cli/raw/master/docs/banner.svg)

Connect this machine to your [agentage](https://agentage.io) account from the terminal, and
install the extensions your account's profile names. One command signs you in through your
browser; the same profile then gives you the same extensions on every machine you set up.

## What is this?

agentage gives your AI tools a shared, account-backed home. Every machine you use is connected
to that account once, by this package. It keeps your sign-in on the machine (OAuth 2.1 with
PKCE, nothing typed into the terminal), tells you whether the machine is connected, and keeps
itself up to date.

The CLI itself stays **small**: sign-in, status, update, and an extension manager. Everything
else, memory included, arrives as an extension the CLI installs for you.

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
agentage setup --no-browser              # prints the sign-in URL to open elsewhere
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

With `AGENTAGE_EXTENSIONS=1` (see below):

| Command                                      | What it does                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `agentage setup --profile <file>`            | Install and load the extensions a profile file names, no sign-in |
| `agentage setup --profile <file> --dry-run`  | Show what would be installed, write nothing                      |
| `agentage extension install <name> [--off]`  | Add an extension to the profile, install and load it             |
| `agentage extension remove <name> [--purge]` | Take it out of the profile and reinstall the rest                |
| `agentage extension list`                    | One row per extension: state, version, commands, last run        |
| `agentage extension check`                   | Load every extension once and refresh the states                 |
| `agentage <command>`                         | Run a command an installed extension contributes                 |

Flags, exit codes and token auth are in [`docs/reference.md`](docs/reference.md).

## Extensions

An extension is an npm package that adds to the CLI: commands today, more later. Extension
support is experimental and off unless you set `AGENTAGE_EXTENSIONS=1`; without it the CLI
behaves exactly as described above.

The model is simple. A **profile** says what this account wants: which extensions, at which
version ranges, and which ones are switched off on which machine. The CLI brings the machine
to that state: `setup` installs what the profile names, loads each extension once and prints
whether it loaded (`ok`) or why not. `extension install` and `extension remove` edit the
profile and then do the same. Nothing installs itself on a timer; the state only changes when
you run a command.

```bash
export AGENTAGE_EXTENSIONS=1
agentage setup --profile ./profile.json            # install and load the extensions a profile names
agentage setup --profile ./profile.json --dry-run  # show the plan, write nothing
agentage setup --check                             # exit 1 when this machine differs from its profile
agentage extension install @agentage/example       # add one extension, install and load it
agentage extension install ./my-extension          # a local folder, for development
agentage extension remove @agentage/example        # take it out again
agentage extension list                            # state per extension, with what setup would change
agentage hello                                     # a command the hello extension contributes
```

The plan is what `setup` would change, one line per extension (`+ add`, `~ update`, `- remove`,
`o off`) and a summary such as `plan: 1 to add, 0 to update, 0 to remove, 0 off, 2 unchanged`.
`setup --dry-run` prints it, `setup --check` exits 1 when anything would change, `extension list`
shows it per extension and `status` sums it up, for example `extensions 2 (1 to add)`.

A profile is a JSON file that maps package names to version ranges. `registries` is optional
and routes a scope to another npm-compatible registry; everything else comes from npm's public
registry.

```json
{
  "version": 1,
  "extensions": { "@agentage/example": "^1.0.0" },
  "registries": { "@acme": "https://npm.acme.example" }
}
```

Extensions run in the CLI process with your privileges, so install only extensions you trust.
npm runs with `--ignore-scripts`, and the account token is removed from the environment before
any extension code loads. Everything lives in the config directory:

| Path                       | What                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `~/.agentage/profile.json` | the profile: what this account wants                           |
| `~/.agentage/machine.json` | this machine's id, name and development extensions             |
| `~/.agentage/extensions/`  | installed extensions; `extensions/current` names the live tree |
| `~/.agentage/state/`       | the last run of each extension                                 |
| `~/.agentage/data/<id>/`   | what each extension keeps                                      |

Every state an extension can be in, and every flag, is in [`docs/reference.md`](docs/reference.md).
To write an extension, start with [`docs/extensions.md`](docs/extensions.md).

## How it works

This is the **terminal client for an agentage account**. `setup` registers a one-off OAuth
client, opens the authorization page in your browser and waits on a localhost callback; the
tokens land in `~/.agentage/auth.json` with owner-only permissions and are refreshed
automatically. `status` validates the session against the account's introspection endpoint
and reports version, update, target host and connectivity. Nothing runs in the background, and
nothing is installed beyond this package unless you turn extensions on.

## Configuration

| Env                       | Default               | Purpose                                            |
| ------------------------- | --------------------- | -------------------------------------------------- |
| `AGENTAGE_SITE_FQDN`      | `agentage.io`         | Target host                                        |
| `AGENTAGE_CONFIG_DIR`     | `~/.agentage`         | Config and credentials directory                   |
| `AGENTAGE_TOKEN`          | -                     | Personal access token for CI and headless machines |
| `AGENTAGE_EXTENSIONS`     | -                     | `1` turns on extension support (experimental)      |
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

## License

MIT - see [LICENSE](./LICENSE).
