# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

The terminal client for [agentage Memory](https://agentage.io) - one memory, every AI, owned by you.

> This package was rebooted as the agentage **Memory client** and its versioning
> restarts at 0.0.x. The old agent-runtime CLI (daemon, run, agents, machines, ...)
> was removed and unpublished.

## Install

```bash
npm install -g @agentage/cli
```

Requires Node.js >= 22.

## Commands

### `agentage setup`

Signs this machine in to your agentage memory. Opens a browser for OAuth 2.1
sign-in (PKCE) and stores the resulting tokens in `~/.agentage/auth.json`
(mode 0600). No passwords ever touch the terminal.

```bash
agentage setup               # browser sign-in, then prints status
agentage setup --no-browser  # print the sign-in URL instead of opening a browser
agentage setup --reauth      # force a fresh sign-in
agentage setup --disconnect  # sign out and remove local credentials
```

### `agentage status`

Shows this machine's connection, one line per fact: CLI version, target,
sign-in state, and endpoint reachability.

```bash
agentage status
agentage status --json
```

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `AGENTAGE_SITE_FQDN` | Target host | `agentage.io` |
| `AGENTAGE_CONFIG_DIR` | Credential/config directory | `~/.agentage` |

## Development

```bash
npm ci
npm run verify                    # type-check + lint + format + unit tests + build
npm run build && npm run test:e2e # live e2e (Playwright) against the dev stack
```

## License

MIT
