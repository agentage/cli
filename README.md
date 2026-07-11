# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

Give every AI on your machine one shared memory - plain markdown you own, synced across your devices.

Claude, Cursor, and your other AI tools each keep their own separate memory today. This
CLI gives them a single shared one. It lives on your disk as ordinary markdown files
you can open, edit, and back up like any other folder. Your AI tools read and write
those same files, so they all remember the same things. Connect a free account and your
memory follows you to every device - and nothing is locked in, because the files are
always just markdown you can export.

## How it fits together

![Architecture](https://github.com/agentage/cli/raw/master/docs/architecture.svg)

## Quickstart

Three steps from nothing to a shared memory your AI can use.

**1. Install it.** Needs Node.js 22 or newer.

```bash
npm install -g @agentage/cli
```

**2. Create a memory.** This makes a plain folder of markdown files at `~/vaults/notes`.
No sign-in needed.

```bash
agentage vault add notes --local
```

**3. Connect your AI.** This example wires up Claude Code over MCP, the open protocol AI
tools use to call tools. Any AI tool that speaks MCP connects the same way.

```bash
claude mcp add --transport http agentage http://127.0.0.1:4243/mcp
```

That's it. Ask your AI to remember something, and it lands in your `~/vaults/notes`
folder as a markdown file you own.

## What your AI can do

Once connected, your AI can:

- Remember things you tell it, saved as a note.
- Find them again later by keyword.
- Read back a specific note in full.
- Update a note in place, or add to it.
- Browse the folders your notes are organized into.
- Remove a note it no longer needs (deletes are recoverable).

You can do all of this from the terminal too - run `agentage memory --help` to see how.

## Sync across devices

Want the same memory on your laptop, desktop, and phone? Connect a free account:

```bash
agentage setup
```

This opens your browser for a one-time sign-in - no API key to copy or passwords in the
terminal. After that, sync runs quietly in the background and the same memory follows
you everywhere. Your files always stay yours: they remain plain markdown on your disk,
and you can export them any time.

Prefer to host it yourself? You can point a memory at your own git remote instead with
`agentage vault add <name> --git <remote>` - see [`docs/reference.md`](docs/reference.md)
for details.

## Token auth (CI / headless)

For CI or non-interactive machines, skip the browser sign-in and authenticate with a
personal access token. Mint one in the dashboard under **Settings -> API tokens**
(scopes `memory:read` / `memory:write`), then set it in the environment:

```bash
export AGENTAGE_TOKEN=aga_...
agentage status
```

The token is used as the bearer for memory (MCP) calls; `--token aga_...` works per command
too. Account-channel provisioning still needs an interactive `agentage setup` session.

## Going deeper

- [`docs/architecture.md`](docs/architecture.md) - how the CLI, the local helper, your
  files, and sync fit together.
- [`docs/reference.md`](docs/reference.md) - every command and flag, the full sync
  options, MCP details, and environment variables.

## Development

```bash
npm ci
npm run verify        # type-check + lint + format:check + unit tests + build
```

End-to-end tests (Playwright) run in tiers - the offline tiers need no network or
account. See [`docs/reference.md`](docs/reference.md) for more.

```bash
npm run build && npm run test:e2e                      # all e2e tiers
npm run build && npm run test:e2e -- --grep @offline   # offline tiers only
```

## License

MIT
