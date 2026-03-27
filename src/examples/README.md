# Agentage Example Agents

Example code agents demonstrating different patterns for building agents with the Agentage platform.

## Agents

### countdown.agent.ts — Pure Async Generator
Counts down from 5 to 0. Demonstrates `createAgent`, yielding events, progress format, and AbortSignal cancellation.

**Dependencies:** `@agentage/core` only

### shell.agent.ts — Shell Command Executor
Runs system commands and streams stdout/stderr as events. Demonstrates subprocess wrapping, line-by-line streaming, exit codes, and process killing on cancel.

**Dependencies:** None (Node.js built-in `child_process`)

### claude-agent.agent.ts — Claude Agent SDK
Full agentic loop using Claude Code. Demonstrates bridging the Claude Agent SDK into Agentage RunEvent protocol, cost tracking, and tool call events.

**Dependencies:** `@anthropic-ai/claude-agent-sdk`
**Requires:** `ANTHROPIC_API_KEY` environment variable + Claude Code CLI

### copilot.agent.ts — GitHub Copilot SDK
Session-based agent using GitHub Copilot. Demonstrates bridging a session-based SDK into RunEvents, lifecycle cleanup, and event collection.

**Dependencies:** `@github/copilot-sdk`
**Requires:** GitHub auth (`gh login` or `GITHUB_TOKEN`)

## Usage

1. Copy an agent to your agents directory:
   ```bash
   cp countdown.agent.ts ~/.agentage/agents/
   ```

2. Refresh agent discovery:
   ```bash
   agentage agents --refresh
   ```

3. Run:
   ```bash
   agentage run countdown
   ```

## Creating Your Own

Use `agentage create` to scaffold a new agent:
```bash
agentage create my-agent                    # Simple template
agentage create my-agent --template shell   # Shell template
agentage create my-agent --template claude  # Claude SDK template
agentage create my-agent --template copilot # Copilot SDK template
```

## Agent Contract

A code agent is a TypeScript/JavaScript file that exports an `Agent` object (from `@agentage/core`):

```typescript
import { createAgent } from '@agentage/core';

export default createAgent({
  name: 'my-agent',        // kebab-case
  description: '...',       // shown in `agentage agents`
  path: '',                 // auto-injected by daemon
  async *run(input, { signal }) {
    // input.task — the prompt/command
    // signal — AbortSignal for cancellation

    yield { type: 'output', data: { type: 'output', content: '...', format: 'text' }, timestamp: Date.now() };
    yield { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() };
  },
});
```

### File Naming

- `countdown.agent.ts` — standalone file (recommended)
- `my-agent/agent.ts` — directory with `agent.ts` inside

Both are discovered by the daemon.

### Cancellation

Check `signal.aborted` in loops and register abort listeners on subprocesses:

```typescript
signal.addEventListener('abort', () => proc.kill(), { once: true });
```

### Dependencies

For agents that need npm packages, install them in the agents directory:

```bash
cd ~/.agentage/agents
npm init -y
npm install @anthropic-ai/claude-agent-sdk
```
