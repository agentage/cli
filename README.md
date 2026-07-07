# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

The offline-first terminal client for [agentage](https://agentage.io) Memory.

**One memory. Every AI. Owned by you.** Your memory is plain markdown on your own
disk. Read and write it from the terminal, serve it to Claude / Cursor / any MCP
client on this machine, and sync it to a git remote you control. Everything works
offline; the cloud account is optional.

## Install

```bash
npm install -g @agentage/cli
```

Requires Node.js >= 22.

## Quickstart

No sign-in required. Register a local vault and start writing:

```bash
agentage vault add notes --local        # a plain folder at ~/vaults/notes
echo "# My first note" | agentage memory write welcome.md --vault notes
agentage memory list --vault notes
agentage memory search first --vault notes
agentage memory read @notes/welcome.md
```

Each vault is a folder of `.md` files backed by git. Every write commits, so nothing
is lost and deletes are recoverable from history.

Want the same memory on more machines, or reachable by AI beyond this box? Connect an
account (optional, still offline-first):

```bash
agentage setup                           # browser OAuth 2.1 sign-in
agentage status                          # version, target, sign-in state, endpoint
```

## Architecture

![Architecture](https://github.com/agentage/cli/raw/master/docs/architecture.svg)

AI clients read and write your memory over MCP: stdio (`agentage mcp`) for a client
you spawn, or the local daemon's HTTP `/mcp` on `127.0.0.1:4243`. The CLI's memory
verbs go through the same daemon, which is the single writer over the vault engine
([`@agentage/memory-core`](https://www.npmjs.com/package/@agentage/memory-core)) and
schedules background sync. Vaults are plain markdown folders on disk, one git repo
per vault. From there they sync out to git remotes you host and, when you sign in, to
your agentage account.

See [`docs/architecture.md`](docs/architecture.md) for a walk-through of the diagram.

## Command reference

Run `agentage <command> --help` for the authoritative options. Global flags:
`--no-daemon` runs memory verbs in-process instead of via the daemon, `-V/--version`
prints the version.

### memory

Six offline verbs over your local vaults. Reference a document as `@<vault>/<path>`
or as `<path> --vault <name>`; omit `--vault` to use the default vault. Every verb
accepts `--json` for machine-readable output.

```bash
agentage memory search <query...>   # search a vault (git grep); --limit <n> (default 20)
agentage memory read <ref>          # print a document
agentage memory write <ref>         # create or overwrite (--body <text>, or stdin)
agentage memory edit <ref>          # --old/--new (str_replace), or --body (--append)
agentage memory list [folder]       # list documents, optionally under a folder
agentage memory delete <ref>        # delete (recoverable from git history)
```

`write` reads the body from `--body` or, when omitted (or `--body -`), from stdin;
pass `--frontmatter '<json>'` to set YAML frontmatter as a JSON object. `edit` either
replaces an exact, unique substring (`--old`/`--new`, omit `--new` to delete the
match) or replaces the whole body (`--body`, add `--append` to append instead).
Documents larger than 64 KB are clamped on read, and the engine refuses to store
obvious secrets. Errors are friendly: an unknown vault, a missing document, or a
non-unique `--old` match report what went wrong and exit non-zero.

### vault

```bash
agentage vault add <name>                  # register a vault (account by default)
agentage vault add <name> --local [path]   # a local folder (default ~/vaults/<name>)
agentage vault add <name> --git <remote>   # synced to an external git remote
agentage vault list                        # list registered vaults (--json)
agentage vault remove <name>               # unregister (files stay on disk)
agentage vault sync [name]                 # sync now; all vaults, or just one
```

`vault add` registers an account vault by default; pass `--local` for a folder that
never leaves this machine, or `--git <remote>` to bind it to a remote you host. For
an account vault, `--path <dir>` sets the local mirror directory.

### setup and status

```bash
agentage setup                      # browser OAuth 2.1 sign-in (PKCE), then prints status
agentage setup --no-browser         # print the sign-in URL instead of opening a browser
agentage setup --reauth             # force a fresh sign-in
agentage setup --disconnect         # sign out and remove local credentials
agentage status                     # CLI version, target, sign-in state, endpoint (--json)
```

No passwords touch the terminal; tokens are stored in `~/.agentage/auth.json`
(mode 0600). `status` also surfaces a passive hint when a newer version is available.

### daemon

```bash
agentage daemon status              # pid, uptime, version
agentage daemon start               # start it explicitly (idempotent)
agentage daemon stop                # stop it
```

### mcp and update

```bash
agentage mcp                        # serve local vaults to on-machine AI over stdio
agentage update                     # install the latest published version
agentage update --check             # report whether an update is available, don't install
```

## Sync

Two channels keep your markdown in sync, and both are optional.

**Git remotes.** Bind a vault to an external remote you host, and the daemon commits
and pushes local changes and pulls remote ones on an interval.

```bash
agentage vault add work --git git@github.com:you/memory.git
agentage vault sync work            # force a cycle now; progress prints per vault
```

**Account sync.** Sign in with `agentage setup` and your account vaults sync to the
agentage cloud, so the same memory follows you across machines.

Conflicts never lose a write. When both sides changed the same file, the remote copy
is kept alongside yours as `<file>.conflict.md` for you to reconcile.

## MCP integration

Any AI client on this machine can read and write your memory through the same frozen
six tools the cloud endpoint exposes: `memory__search`, `memory__read`,
`memory__write`, `memory__edit`, `memory__list`, and `memory__delete`.

**stdio.** `agentage mcp` serves your local vaults over stdio. Point a client at it
by spawning the command:

```json
{
  "mcpServers": {
    "agentage-memory": {
      "command": "agentage",
      "args": ["mcp"]
    }
  }
}
```

Drop that into your client's MCP config (for example `~/.cursor/mcp.json`, or via
`claude mcp add`) and the assistant reads and writes the same markdown you do.

**HTTP.** Clients that speak Streamable HTTP can use the daemon's endpoint at
`http://127.0.0.1:4243/mcp`. The cloud MCP endpoint, for AI outside this machine, is
`memory.agentage.io/mcp`.

## The daemon

A small local daemon (loopback only, `127.0.0.1:4243` by default) owns the engine so
vault writes are serialized and sync runs in the background. It autostarts on the
first memory verb; you rarely touch it directly. Its API is bound to `127.0.0.1`,
token-guarded, and rejects cross-origin requests, so nothing off the machine can
reach it. If the port is already in use it reports the conflict rather than failing
silently.

To skip the daemon and run verbs in-process, pass `--no-daemon` or set
`AGENTAGE_NO_DAEMON=1`.

## Environment

| Variable               | Purpose                                                             | Default       |
| ---------------------- | ------------------------------------------------------------------- | ------------- |
| `AGENTAGE_CONFIG_DIR`  | Config + credentials dir (`auth.json`, `vaults.json`, daemon state) | `~/.agentage` |
| `AGENTAGE_DAEMON_PORT` | Local daemon port                                                   | `4243`        |
| `AGENTAGE_NO_DAEMON`   | Set to `1` to run memory verbs in-process                           | unset         |
| `AGENTAGE_SITE_FQDN`   | Cloud target host                                                   | `agentage.io` |

## Development

```bash
npm ci
npm run verify                    # type-check + lint + format:check + unit tests + build
```

End-to-end tests (Playwright) run in tiers. The offline tiers drive the built
`dist/cli.js` in-process and need no network or account; the live tiers exercise the
full OAuth round trip against a running stack.

```bash
npm run build && npm run test:e2e                      # all e2e tiers
npm run build && npm run test:e2e -- --grep @offline   # offline tiers only
```

## License

MIT
