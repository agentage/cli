import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import { type Command } from 'commander';
import chalk from 'chalk';
import { type Agent, type AgentManifest, type RunEvent, type RunInput } from '@agentage/core';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { connectWs, get, post } from '../utils/daemon-client.js';
import { renderEvent } from '../utils/render.js';
import { loadProjects, resolveProject } from '../projects/projects.js';
import { createMarkdownFactory } from '../discovery/markdown-factory.js';
import { createCodeFactory } from '../discovery/code-factory.js';
import {
  mergeInputs,
  parseInputJson,
  validateInput,
  type Input,
  type JsonSchema,
} from '../utils/schema-input.js';

interface RunResponse {
  runId: string;
}

interface WsRunEventMessage {
  type: 'run_event';
  runId: string;
  event: RunEvent;
}

interface WsRunStateMessage {
  type: 'run_state';
  run: { id: string; state: string };
}

type WsMessage = WsRunEventMessage | WsRunStateMessage;

const TERMINAL_STATES = ['completed', 'failed', 'canceled'];

const isAgentPath = (input: string): boolean => {
  if (input.includes('/')) return true;
  if (/\.(agent\.md|agent\.ts|agent\.js|md|ts|js)$/.test(input)) return true;
  return false;
};

const expandPath = (input: string): string => {
  if (input.startsWith('~')) return resolvePath(homedir(), input.slice(1).replace(/^\/+/, ''));
  return resolvePath(input);
};

const parseAgentTarget = (input: string): { agentName: string; machineName?: string } => {
  const atIndex = input.lastIndexOf('@');
  if (atIndex > 0) {
    return {
      agentName: input.substring(0, atIndex),
      machineName: input.substring(atIndex + 1),
    };
  }
  return { agentName: input };
};

export const registerRun = (program: Command): void => {
  program
    .command('run')
    .argument('<agent>', 'Agent name (or agent@machine for remote)')
    .argument('[prompt]', 'Task/prompt for the agent')
    .description('Run an agent')
    .option('-d, --detach', 'Run in background, print run ID')
    .option('--json', 'Output events as JSON lines')
    .option('--config <json>', 'Per-run config overrides (JSON)')
    .option('--input <json>', 'Structured input matching the agent inputSchema (JSON object)')
    .option('--context <paths...>', 'Additional context files')
    .option('--project <name-or-path>', 'Project context (name, name:branch, or path)')
    .action(
      async (
        agent: string,
        prompt: string | undefined,
        opts: {
          detach?: boolean;
          json?: boolean;
          config?: string;
          input?: string;
          context?: string[];
          project?: string;
        }
      ) => {
        const task = prompt ?? '';

        if (isAgentPath(agent)) {
          if (opts.detach) {
            console.error(
              chalk.red(
                '--detach requires a daemon. Omit --detach for standalone file runs, or register this agent in a discovery dir.'
              )
            );
            process.exitCode = 1;
            return;
          }
          await runStandalone(expandPath(agent), task, opts);
          setTimeout(() => process.exit(process.exitCode ?? 0), 100);
          return;
        }

        await ensureDaemon();

        const { agentName, machineName } = parseAgentTarget(agent);
        const project = resolveProject(opts.project, loadProjects());

        if (machineName) {
          await runRemote(agentName, machineName, task, opts, project);
        } else {
          await runLocal(agentName, task, opts, project);
        }
        // Let the event loop drain pending writes, then exit
        setTimeout(() => process.exit(process.exitCode ?? 0), 100);
      }
    );
};

const parseJsonOption = (name: string, raw: string | undefined): Input | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON object`);
    }
    return parsed as Input;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${name}: ${message}`);
  }
};

const resolveConfig = (
  opts: { config?: string; input?: string },
  inputSchema: JsonSchema | undefined
): Input | undefined => {
  const fromConfig = parseJsonOption('--config', opts.config);
  const fromInput = opts.input ? parseInputJson(opts.input) : undefined;
  const merged = mergeInputs(fromConfig, fromInput);
  const hasAny = Object.keys(merged).length > 0;

  if (!inputSchema) return hasAny ? merged : undefined;

  const result = validateInput(inputSchema, merged);
  if (!result.ok) {
    const detail = result.errors.map((e) => `  • ${e}`).join('\n');
    throw new Error(`Input does not match agent schema:\n${detail}`);
  }
  return Object.keys(result.value).length > 0 ? result.value : undefined;
};

const runLocal = async (
  agentName: string,
  prompt: string,
  opts: { detach?: boolean; json?: boolean; config?: string; input?: string; context?: string[] },
  project?: { name: string; path: string; branch?: string; remote?: string }
): Promise<void> => {
  let manifest: AgentManifest | undefined;
  try {
    manifest = await get<AgentManifest>(`/api/agents/${agentName}`);
  } catch {
    // Older daemon may not expose this endpoint; skip schema validation
  }

  let config: Input | undefined;
  try {
    config = resolveConfig(opts, manifest?.inputSchema);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return;
  }

  const { runId } = await post<RunResponse>(`/api/agents/${agentName}/run`, {
    task: prompt,
    config,
    context: opts.context,
    project,
  });

  if (opts.detach) {
    console.log(runId);
    return;
  }

  await streamRun(runId, opts.json ?? false);
};

const runRemote = async (
  agentName: string,
  machineName: string,
  prompt: string,
  opts: { detach?: boolean; json?: boolean },
  project?: { name: string; path: string; branch?: string; remote?: string }
): Promise<void> => {
  // Resolve machine name to machine ID
  let machines: Array<{ id: string; name: string }>;
  try {
    machines = await get<Array<{ id: string; name: string }>>('/api/hub/machines');
  } catch {
    console.error(chalk.red("Not connected to hub. Run 'agentage setup' first."));
    process.exitCode = 1;
    return;
  }

  const machine = machines.find((m) => m.name === machineName);
  if (!machine) {
    console.error(chalk.red(`Machine "${machineName}" not found.`));
    console.error(chalk.dim(`Available: ${machines.map((m) => m.name).join(', ') || 'none'}`));
    process.exitCode = 1;
    return;
  }

  // Create run via hub
  let result: { runId?: string };
  try {
    result = await post<{ runId?: string }>('/api/hub/runs', {
      machineId: machine.id,
      agentName,
      input: prompt,
      project,
    });
  } catch (err) {
    console.error(
      chalk.red(`Failed to start remote run: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exitCode = 1;
    return;
  }

  const runId = result.runId ?? (result as Record<string, unknown>).runId;
  if (!runId) {
    console.error(chalk.red('Failed to get run ID from hub'));
    process.exitCode = 1;
    return;
  }

  if (opts.detach) {
    console.log(runId);
    return;
  }

  console.log(chalk.dim(`Running ${agentName} on ${machineName}...`));

  // Poll for events from hub (MVP approach — daemon proxies)
  await pollRemoteRun(runId as string, opts.json ?? false);
};

const streamRun = (runId: string, jsonMode: boolean): Promise<void> =>
  new Promise((resolve) => {
    const ws = connectWs((data) => {
      const msg = data as WsMessage;

      if (msg.type === 'run_event' && msg.runId === runId) {
        if (jsonMode) {
          console.log(JSON.stringify(msg.event));
        } else {
          renderEvent(msg.event);
        }
      }

      if (msg.type === 'run_state' && msg.run.id === runId) {
        if (TERMINAL_STATES.includes(msg.run.state)) {
          ws.close();
          resolve();
        }
      }
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', runId }));
    });

    ws.on('error', () => {
      resolve();
    });

    ws.on('close', () => {
      resolve();
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      post(`/api/runs/${runId}/cancel`).catch(() => {});
      ws.close();
      resolve();
    });
  });

const pollRemoteRun = async (runId: string, jsonMode: boolean): Promise<void> => {
  let lastEventId: string | undefined;
  const pollInterval = 1000;

  const poll = async (): Promise<boolean> => {
    try {
      const url = lastEventId
        ? `/api/hub/runs/${runId}/events?after=${lastEventId}`
        : `/api/hub/runs/${runId}/events`;

      const events = await get<Array<{ id: string; type: string; data: unknown }>>(url);

      for (const event of events) {
        if (jsonMode) {
          console.log(JSON.stringify(event));
        } else {
          renderEvent(event as unknown as RunEvent);
        }
        lastEventId = event.id;
      }

      // Check run state
      const run = await get<{ state: string }>(`/api/hub/runs/${runId}`);
      if (TERMINAL_STATES.includes(run.state)) {
        return true;
      }
    } catch {
      // Hub may be temporarily unreachable
    }
    return false;
  };

  while (true) {
    const done = await poll();
    if (done) break;
    await new Promise((r) => setTimeout(r, pollInterval));
  }
};

const loadAgentFromPath = async (filePath: string): Promise<Agent | null> => {
  const markdownFactory = createMarkdownFactory();
  const codeFactory = createCodeFactory();
  const md = await markdownFactory(filePath);
  if (md) return md;
  const code = await codeFactory(filePath);
  if (code) return code;
  return null;
};

const runStandalone = async (
  filePath: string,
  prompt: string,
  opts: { json?: boolean; config?: string; input?: string; context?: string[] }
): Promise<void> => {
  if (!existsSync(filePath)) {
    console.error(chalk.red(`Agent file not found: ${filePath}`));
    process.exitCode = 1;
    return;
  }

  let agent: Agent | null;
  try {
    agent = await loadAgentFromPath(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to load agent: ${message}`));
    process.exitCode = 1;
    return;
  }

  if (!agent) {
    console.error(
      chalk.red(
        `File is not a recognized agent: ${filePath} (expected .agent.md, .agent.ts, .agent.js, or SKILL.md)`
      )
    );
    process.exitCode = 1;
    return;
  }

  let config: Input | undefined;
  try {
    config = resolveConfig(opts, agent.manifest.inputSchema as JsonSchema | undefined);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return;
  }
  const input: RunInput = { task: prompt, config, context: opts.context };

  let proc;
  try {
    proc = await agent.run(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Agent execution failed: ${message}`));
    process.exitCode = 1;
    return;
  }

  const onSigint = (): void => {
    proc.cancel();
  };
  process.on('SIGINT', onSigint);

  try {
    for await (const event of proc.events as AsyncIterable<RunEvent>) {
      if (opts.json) {
        console.log(JSON.stringify(event));
      } else {
        renderEvent(event);
      }
      if (event.data.type === 'error') {
        process.exitCode = 1;
      }
      if (event.data.type === 'result' && event.data.success === false) {
        process.exitCode = 1;
      }
      if (event.data.type === 'state' && event.data.state === 'failed') {
        process.exitCode = 1;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Agent execution error: ${message}`));
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
};
