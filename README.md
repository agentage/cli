# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

Connect this machine to your [agentage](https://agentage.io) account from the terminal. One
command signs you in through your browser; from then on the machine is known to your account.

## What is this?

`agentage` is the command-line entry point to agentage. It keeps your sign-in on this machine
(OAuth 2.1 with PKCE, nothing typed into the terminal), tells you whether the machine is connected,
and keeps itself up to date. It is intentionally small: everything beyond sign-in, status and
update arrives as plugins the CLI installs for you.

## Get started

Needs Node.js 22 or newer.

```bash
npm install -g @agentage/cli
agentage setup
```

`setup` opens your browser, you sign in, and the CLI stores the session in `~/.agentage`. Then:

```bash
agentage status
```

prints the version, whether an update is available, the target host, your sign-in state and
whether the endpoint is reachable.

## Commands

| Command                       | What it does                                                            |
| ----------------------------- | ----------------------------------------------------------------------- |
| `agentage setup`              | Sign in through your browser, then show status                          |
| `agentage setup --no-browser` | Print the sign-in URL instead of opening a browser (SSH, containers)    |
| `agentage setup --reauth`     | Force a fresh sign-in                                                   |
| `agentage setup --disconnect` | Sign out and remove local credentials                                   |
| `agentage status`             | Version, update, target, sign-in state, endpoint (`--json` for scripts) |
| `agentage update`             | Install the latest published version (`--check` only reports)           |

Flags, exit codes and token auth for CI are in [`docs/reference.md`](docs/reference.md).

## Configuration

| Env                   | Default       | Purpose                                            |
| --------------------- | ------------- | -------------------------------------------------- |
| `AGENTAGE_SITE_FQDN`  | `agentage.io` | Target host                                        |
| `AGENTAGE_CONFIG_DIR` | `~/.agentage` | Config and credentials directory                   |
| `AGENTAGE_TOKEN`      | -             | Personal access token for CI and headless machines |
| `AGENTAGE_DEBUG`      | -             | Print diagnostics to stderr                        |
| `NO_COLOR`            | -             | Disable colored output                             |

## Develop

```bash
npm ci
npm run verify                                         # type-check + lint + format:check + test + build
npm run build && npm run test:e2e -- --grep @offline   # offline e2e: no network, no account
```

## Release

Releases publish to npm via GitHub Actions when a `chore(release): X.Y.Z` commit that touches
`package.json` lands on `master` (the squash-merge subject of a release PR). The workflow skips
any version already on npm.

## License

MIT - see [LICENSE](./LICENSE).
