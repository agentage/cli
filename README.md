# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

Connect this machine to your agentage account from the terminal.

Plugins will extend the CLI with more commands.

## Quickstart

Needs Node.js 22 or newer.

```bash
npm install -g @agentage/cli
agentage setup    # sign in through your browser
agentage status   # version, sign-in state and connectivity
```

## Commands

| Command                       | What it does                                                         |
| ----------------------------- | -------------------------------------------------------------------- |
| `agentage setup`              | Sign in through your browser (OAuth 2.1 with PKCE), then show status |
| `agentage setup --no-browser` | Print the sign-in URL instead of opening a browser                   |
| `agentage setup --reauth`     | Force a fresh sign-in                                                |
| `agentage setup --disconnect` | Sign out and remove local credentials                                |
| `agentage status`             | Version, update, target, sign-in and endpoint (`--json`, `--token`)  |
| `agentage update`             | Install the latest published version (`--check` only reports)        |

Flags, exit codes and token auth for CI: [`docs/reference.md`](docs/reference.md).

## Environment

| Variable              | Purpose                                            | Default       |
| --------------------- | -------------------------------------------------- | ------------- |
| `AGENTAGE_SITE_FQDN`  | Target host                                        | `agentage.io` |
| `AGENTAGE_CONFIG_DIR` | Config and credentials directory                   | `~/.agentage` |
| `AGENTAGE_TOKEN`      | Personal access token for CI and headless machines | unset         |
| `AGENTAGE_DEBUG`      | Print diagnostics to stderr                        | unset         |
| `NO_COLOR`            | Disable colored output                             | unset         |

## Development

```bash
npm ci
npm run verify                                         # type-check, lint, format, unit tests, build
npm run build && npm run test:e2e -- --grep @offline   # offline e2e, no network or account
```

## License

MIT
