# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**@agentage/cli** — CLI and daemon for the Agentage platform. Provides the `agentage` command-line tool and a local daemon process that discovers, runs, and manages AI agents.

**Repository:** `agentage/cli`
**Default Branch:** `master`
**Package:** Single npm package (ESM)

## Development Commands

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript (tsc)
npm test                 # Run Vitest unit tests
npm run type-check       # TypeScript checking
npm run lint             # ESLint
npm run format:check     # Prettier check
npm run verify           # Full pipeline: type-check + lint + format:check + build + test
npm run clean            # Clean dist/
```

## Architecture

```
src/
├── cli.ts               # CLI entrypoint (Commander.js)
├── commands/            # CLI commands (init, publish, list, etc.)
├── daemon/              # Local daemon (Express + WebSocket)
├── hub/                 # Hub client for cloud interactions
├── discovery/           # Agent discovery from filesystem
└── utils/               # Shared utilities
```

### Key Patterns

- **CLI:** Commander.js command definitions in `src/commands/`
- **Daemon:** Express.js HTTP + WebSocket server for agent lifecycle management
- **Discovery:** Filesystem scanning for `.agent.md` and `.agent.ts` files
- **Hub Integration:** Supabase client for cloud platform communication

### Key Dependencies

- `@agentage/core`, `@agentage/platform` — Agent framework
- `commander` — CLI framework
- `express`, `ws` — Daemon server
- `@supabase/supabase-js` — Cloud platform
- `gray-matter` — Agent manifest parsing
- `chalk` — Terminal output

## Testing

- **Framework:** Vitest
- **Pattern:** `*.test.ts` colocated with source
- **Coverage:** 70% minimum threshold

## Publishing

Published to npm as `@agentage/cli`. **Never run `npm publish` manually** — use the automated release pipeline via GitHub Actions.

## Standards

See [root CLAUDE.md](../../CLAUDE.md) and [agentage CLAUDE.md](../CLAUDE.md) for cross-repo conventions, branching strategy, and tech standards.
