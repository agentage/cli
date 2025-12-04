# AgentKit CLI

[![CI](https://github.com/agentage/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/agentage/cli/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40agentage%2Fcli.svg)](https://badge.fury.io/js/%40agentage%2Fcli)

Command-line interface for creating and managing AI agents.

## Installation

Install globally:

```bash
npm install -g @agentage/cli
```

Or use with npx:

```bash
npx @agentage/cli <command>
```

## Quick Start

```bash
# Create a new agent
agent init my-assistant

# Run the agent
agent run my-assistant "Hello, how are you?"

# List all agents
agent list
```

## Commands

### `agent init [name]`

Create a new agent configuration file.

```bash
# Create agent with default name
agent init

# Create agent with custom name
agent init my-assistant

# Create in global directory
agent init my-agent --global
```

### `agent run <name> [prompt]`

Execute an agent with a prompt.

```bash
# Run with default prompt
agent run my-assistant

# Run with custom prompt
agent run my-assistant "What is TypeScript?"
```

### `agent list`

List all available agents (local and global).

```bash
agent list
```

### `agent publish [path]`

Publish an agent to the Agentage registry.

```bash
# Publish agent in current directory
agent publish

# Publish specific agent file
agent publish agents/my-agent.agent.md

# Dry run (validate without publishing)
agent publish --dry-run
```

### `agent install <owner/name>`

Install an agent from the registry.

```bash
# Install latest version
agent install user/my-agent

# Install specific version
agent install user/my-agent@2025-01-01

# Install globally
agent install user/my-agent --global
```

### `agent search <query>`

Search for agents in the registry.

```bash
# Search for agents
agent search "code review"

# Limit results
agent search "ai assistant" --limit 5
```

### `agent login`

Authenticate with the Agentage registry.

```bash
agent login
```

### `agent logout`

Log out from the registry.

```bash
agent logout
```

### `agent whoami`

Display the currently logged in user.

```bash
agent whoami
```

### `agent update`

Update the CLI to the latest version.

```bash
agent update
```

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Type check
npm run type-check

# Full verification (type-check, lint, build, test)
npm run verify
```

### Project Structure

```
cli/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── index.ts            # Package exports
│   ├── commands/           # CLI command handlers
│   │   ├── init.ts
│   │   ├── run.ts
│   │   ├── list.ts
│   │   ├── publish.ts
│   │   ├── install.ts
│   │   ├── search.ts
│   │   ├── login.ts
│   │   ├── logout.ts
│   │   ├── whoami.ts
│   │   └── update.ts
│   ├── services/           # API services
│   │   ├── auth.service.ts
│   │   └── registry.service.ts
│   ├── utils/              # Utility functions
│   │   ├── agent-parser.ts
│   │   ├── config.ts
│   │   ├── lockfile.ts
│   │   └── version.ts
│   ├── schemas/            # Zod schemas
│   │   └── agent.schema.ts
│   ├── types/              # TypeScript types
│   │   ├── config.types.ts
│   │   ├── lockfile.types.ts
│   │   └── registry.types.ts
│   └── __mocks__/          # Jest mocks
│       └── chalk.ts
├── package.json
├── tsconfig.json
├── jest.config.js
├── eslint.config.js
└── README.md
```

## License

MIT
