# @agentage/cli

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

CLI and daemon for the [Agentage](https://agentage.io) control plane. Discovers local agents, executes them, and connects to the hub for multi-machine orchestration.

## Installation

```bash
npm install -g @agentage/cli
```

## Quick Start — 5 minutes to your first agent

From `npm install` to a running agent in five commands. No hub, no login, no API key required.

### 1. Install

```bash
npm install -g @agentage/cli
```

### 2. Write an agent

Create `~/agents/hello.agent.md` (the default agents directory — see `agentage status` to confirm or change):

```markdown
---
description: Simple greeting agent
---
You greet the user by name. Reply in exactly one short sentence.
```

That's a complete agent — YAML frontmatter plus a system prompt. The daemon picks up any `.agent.md` file it finds.

### 3. Verify discovery

```bash
agentage agents
```

```
NAME    DESCRIPTION              PATH
hello   Simple greeting agent    ~/agents/hello.agent.md

1 agents discovered
```

The daemon auto-starts on first command and listens on `localhost:4243`.

### 4. Run it

```bash
agentage run hello "Volodymyr"
```

Without an LLM adapter configured, markdown agents echo the prompt plus the task — enough to confirm the pipeline is wired. For a real model response, scaffold a code agent that uses the Claude adapter:

```bash
agentage create greeter -t claude    # writes greeter.agent.ts
npm install @anthropic-ai/claude-agent-sdk
export ANTHROPIC_API_KEY=sk-…
agentage run greeter "Hi"
```

### 5. Explore

```bash
agentage status       # daemon + hub health, discovery dirs
agentage runs         # history of recent runs
agentage create --help   # other templates: simple, shell, claude, copilot, llm
```

### Real-world example

The [`pr-list`](https://github.com/vreshch/agents/tree/master/plugins/pr-list) agent (private repo) is a deterministic utility that queries `gh pr list` across a set of repos and returns a structured table. It's the smallest example of a code agent (`.agent.ts`) that uses a config object and has no LLM dependency — a good reference for your first "real" agent.

## Daemon

The daemon is a lightweight Express server that runs on each machine. It discovers local agents, executes them, and optionally syncs with a central hub.

### API

| Method | Endpoint                | Description                                         |
| ------ | ----------------------- | --------------------------------------------------- |
| `GET`  | `/api/health`           | Status, version, uptime, machine ID, hub connection |
| `GET`  | `/api/agents`           | List discovered agent manifests                     |
| `POST` | `/api/agents/refresh`   | Re-scan agent directories                           |
| `POST` | `/api/agents/:name/run` | Execute an agent (`{ task, config?, context? }`)    |
| `GET`  | `/api/runs`             | List all runs                                       |
| `GET`  | `/api/runs/:id`         | Get run details + output                            |
| `POST` | `/api/runs/:id/cancel`  | Cancel a running execution                          |
| `POST` | `/api/runs/:id/input`   | Send input to a waiting agent                       |

Default port: **4243**

### Agent Discovery

The daemon scans configured directories for agents:

```
~/.agentage/agents/*.agent.md    # Global agents
.agentage/agents/*.agent.md      # Workspace agents
```

Two built-in factories: **markdown** (`.agent.md` files with YAML frontmatter) and **code** (TypeScript/JavaScript modules exporting an Agent).

### Hub Sync

When authenticated (`agentage setup`), the daemon connects to the hub via WebSocket — registering the machine, syncing agents, and relaying run events.

| Method | Endpoint            | Description                           |
| ------ | ------------------- | ------------------------------------- |
| `GET`  | `/api/hub/machines` | List all hub-connected machines       |
| `GET`  | `/api/hub/agents`   | Aggregated agents across all machines |
| `POST` | `/api/hub/runs`     | Start a run on any connected machine  |

#### Resilience

The daemon is designed to keep its hub connection alive across transient network failures, auth expiry, and hub restarts — without requiring a restart of the daemon process.

| Behavior                | Value                                                           | Source                                                    |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Heartbeat interval      | **30 s**                                                        | `HEARTBEAT_INTERVAL_MS` in `src/hub/hub-sync.ts`          |
| Heartbeat scheduling    | Sequential (next scheduled after current resolves — no overlap) | `src/hub/hub-sync.ts`                                     |
| Reconnect initial delay | **1 s**                                                         | `initialDelayMs` in `src/hub/reconnection.ts`             |
| Reconnect max delay     | **30 s**                                                        | `maxDelayMs` in `src/hub/reconnection.ts`                 |
| Reconnect backoff       | Exponential (×2 per failed attempt, capped at max)              | `src/hub/reconnection.ts`                                 |
| Token refresh threshold | **5 min** before expiry                                         | `TOKEN_REFRESH_THRESHOLD_S` in `src/hub/token-refresh.ts` |
| Token refresh trigger   | Pre-heartbeat check + reactive on 401                           | `token-refresh.ts`, `hub-client.ts`                       |

**Heartbeat payload.** Each heartbeat POSTs `{ agents, activeRunIds, daemonVersion }` to `/api/machines/:id/heartbeat`. The response may contain `pendingCommands` (e.g. queued `cancel` or `input` requests from the hub) which are applied to the local run-manager inline before the next heartbeat.

**Reconnection flow.**

1. Hub WS `close` event fires → `connected` set to `false`, reconnector started.
2. Reconnector calls `connectAll` (re-register machine + reopen WS) with exponential backoff.
3. On success, backoff delay resets to 1 s and the heartbeat loop resumes.
4. `stop()` (daemon shutdown) cancels the reconnector and deregisters the machine best-effort.

**Auth handling.** Token refresh is attempted both proactively (before each heartbeat, if within 5 min of expiry) and reactively (on any hub API 401 response). Refresh uses the Supabase refresh token fetched from `/api/health`. A failed refresh surfaces as a warning but does not kill the daemon — the next reconnect cycle will retry.

**Offline mode.** If no auth is present at startup, the daemon runs in standalone mode: local agent execution still works via the REST API and local WebSocket (`/ws`), but no hub sync is attempted. Running `agentage setup` after the fact requires a daemon restart to pick up the new auth.

## CLI Commands

| Command                      | Description                 |
| ---------------------------- | --------------------------- |
| `agentage daemon`            | Start the daemon server     |
| `agentage agents`            | List discovered agents      |
| `agentage run <name> [task]` | Execute an agent            |
| `agentage runs`              | List runs                   |
| `agentage machines`          | List hub-connected machines |
| `agentage status`            | Show daemon and hub status  |
| `agentage logs`              | View daemon logs            |
| `agentage setup`             | Configure machine + hub + auth (interactive or headless) |
| `agentage setup --disconnect` | Deregister and remove credentials |

## Project Structure

```
src/
├── cli.ts                  # CLI entry point (commander)
├── daemon-entry.ts         # Daemon process entry point
├── commands/               # CLI command handlers
│   ├── daemon-cmd.ts       #   agentage daemon
│   ├── agents.ts           #   agentage agents
│   ├── run.ts              #   agentage run
│   ├── runs.ts             #   agentage runs
│   ├── machines.ts         #   agentage machines
│   ├── status.ts           #   agentage status
│   ├── logs.ts             #   agentage logs
│   └── setup.ts           #   agentage setup
├── daemon/                 # Daemon server
│   ├── server.ts           #   Express + HTTP server setup
│   ├── routes.ts           #   REST API routes
│   ├── config.ts           #   Daemon configuration
│   ├── run-manager.ts      #   Agent execution + run lifecycle
│   ├── websocket.ts        #   WebSocket for streaming
│   └── logger.ts           #   Structured logging
├── discovery/              # Agent discovery
│   ├── scanner.ts          #   Directory scanning
│   ├── markdown-factory.ts #   .agent.md parser (gray-matter)
│   └── code-factory.ts     #   JS/TS module loader (jiti)
├── hub/                    # Hub connection
│   ├── auth.ts             #   Auth token storage
│   ├── auth-callback.ts    #   OAuth callback server
│   ├── hub-client.ts       #   Hub REST client
│   ├── hub-sync.ts         #   Machine/agent sync
│   ├── hub-ws.ts           #   Hub WebSocket client
│   └── reconnection.ts     #   Auto-reconnect logic
└── utils/
    ├── daemon-client.ts    #   CLI → daemon HTTP client
    ├── ensure-daemon.ts    #   Auto-start daemon if not running
    └── render.ts           #   Terminal output formatting
```

## Development

Requires Node.js >= 22.0.0.

```bash
npm ci
npm run verify    # type-check + lint + format + test + build
npm run build && npm link   # test CLI locally
```

## License

MIT
