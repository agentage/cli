# Architecture

![Architecture](https://github.com/agentage/cli/raw/master/docs/architecture.svg)

The pieces, top to bottom.

- **AI tools** (Claude Code, Cursor, editors) reach your memory over MCP through one
  of two entry points:
  - **stdio** - a client you spawn with `agentage mcp`.
  - **HTTP** - the local daemon's `/mcp` endpoint on `127.0.0.1:4243`.
  Both expose the same frozen six tools: `memory__search`, `memory__read`,
  `memory__write`, `memory__edit`, `memory__list`, `memory__delete`.
- **agentage CLI** - the `memory`, `vault`, `setup`, `status`, `daemon`, and `mcp`
  commands. Memory verbs default to the daemon; `--no-daemon` runs them in-process.
- **Local daemon** (`127.0.0.1:4243`) - the single writer over the vault engine, so
  concurrent writes are serialized. It also schedules background sync. The API is
  loopback-only and token-guarded.
- **Local vaults** - plain markdown folders on disk, one git repo per vault, backed
  by the [`@agentage/memory-core`](https://www.npmjs.com/package/@agentage/memory-core)
  engine. Every write commits; deletes are recoverable from history.
- **Sync channels** (both optional):
  - **Git remotes** you host - the daemon commits, pushes, and pulls on an interval.
  - **Account sync** to the agentage cloud after `agentage setup` (OAuth 2.1 sign-in
    at `auth.agentage.io`), so the same memory follows you across machines.

Conflicts never lose a write: when both sides change the same file, the remote copy
is kept alongside yours as `<file>.conflict.md`.
