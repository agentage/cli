# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

The offline-first terminal client for [agentage](https://agentage.io) Memory.

**One memory. Every AI. Owned by you.** Your memory is plain markdown on your own
disk. Read and write it from the terminal, serve it to Claude / Cursor / any MCP
client on this machine, and sync it to a git remote you control. Everything works
offline; the cloud is optional.

## Install

```bash
npm install -g @agentage/cli
```

Requires Node.js >= 22.

## Quickstart

```bash
agentage vault add notes --local        # register a vault at ~/vaults/notes
echo "# My first note" | agentage memory write welcome.md --vault notes
agentage memory list --vault notes
agentage memory search "first" --vault notes
agentage memory read @notes/welcome.md
```

No sign-in required. Each vault is a plain folder of `.md` files backed by git; every
write commits, so nothing is lost and deletes are recoverable from history.

## Memory

Six offline verbs over your local vaults. Reference a document as `@<vault>/<path>`
or as `<path> --vault <name>`; omit `--vault` to use the default vault. Every verb
accepts `--json` for machine-readable output.

```bash
agentage memory search <query...>   # search a vault (git grep); --limit <n>
agentage memory read <ref>          # print a document
agentage memory write <ref>         # create or overwrite (--body <text>, or stdin)
agentage memory edit <ref>          # --old/--new (str_replace), or --body (--append)
agentage memory list [folder]       # list documents, optionally under a folder
agentage memory delete <ref>        # delete (recoverable from git history)
```

`write` reads the body from `--body` or, when omitted (or `--body -`), from stdin;
pass `--frontmatter '<json>'` to set YAML frontmatter. Documents larger than 64 KB
are clamped on read, and the engine refuses to store obvious secrets.

## Connect your AI (MCP)

`agentage mcp` serves your local vaults to any on-machine AI client over stdio, as
the same frozen six `memory__{search,read,write,edit,list,delete}` tools the cloud
endpoint exposes. Point a client at it by spawning the command:

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

Clients that speak Streamable HTTP can instead use the daemon's endpoint at
`http://127.0.0.1:4243/mcp`. The cloud MCP endpoint, for AI outside this machine, is
`memory.agentage.io/mcp`.

## Git sync

Register a vault against an external git remote and the daemon keeps it in sync,
committing and pushing local changes and pulling remote ones on an interval.

```bash
agentage vault add work --git git@github.com:you/memory.git
agentage vault list
agentage vault sync            # sync every git-backed vault now
agentage vault sync work       # sync just one
```

Conflicts never lose a write: the remote copy is kept alongside yours as
`<file>.conflict.md` for you to reconcile.

## The daemon

A small local daemon (loopback only, `127.0.0.1:4243` by default) owns the engine so
vault writes are serialized and git sync runs in the background. It autostarts on the
first memory verb; you rarely touch it directly.

```bash
agentage daemon status         # pid, uptime, version, per-vault sync state
agentage daemon start          # start it explicitly (idempotent)
agentage daemon stop           # stop it
```

To skip the daemon and run verbs in-process, pass `--no-daemon` or set
`AGENTAGE_NO_DAEMON=1`.

## Cloud account

Sign in to connect this machine to your agentage account. This is optional; the
memory verbs above work fully offline without it.

```bash
agentage setup                 # browser OAuth 2.1 sign-in (PKCE), then prints status
agentage setup --no-browser    # print the sign-in URL instead of opening a browser
agentage setup --reauth        # force a fresh sign-in
agentage setup --disconnect    # sign out and remove local credentials

agentage status                # CLI version, target, sign-in state, endpoint (--json)
```

No passwords touch the terminal; tokens are stored in `~/.agentage/auth.json`
(mode 0600).

## Update

```bash
agentage update                # install the latest published version
agentage update --check        # report whether an update is available, don't install
```

`status` also surfaces a passive hint when a newer version is available.

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
npm run verify                    # type-check + lint + format + unit tests + build
npm run build && npm run test:e2e # live e2e (Playwright) against the dev stack
```

## License

MIT
