import { type Command } from 'commander';
import chalk from 'chalk';
import { type RunEvent } from '@agentage/core';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { connectWs, get, post } from '../utils/daemon-client.js';
import { renderEvent } from '../utils/render.js';
import { loadProjects, resolveProject } from '../projects/projects.js';

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
          context?: string[];
          project?: string;
        }
      ) => {
        await ensureDaemon();

        if (!prompt) {
          console.error(chalk.red('Prompt is required. Usage: agentage run <agent> "<prompt>"'));
          process.exitCode = 1;
          return;
        }

        const { agentName, machineName } = parseAgentTarget(agent);
        const project = resolveProject(opts.project, loadProjects());

        if (machineName) {
          await runRemote(agentName, machineName, prompt, opts, project);
        } else {
          await runLocal(agentName, prompt, opts, project);
        }
        // Let the event loop drain pending writes, then exit
        setTimeout(() => process.exit(process.exitCode ?? 0), 100);
      }
    );
};

const runLocal = async (
  agentName: string,
  prompt: string,
  opts: { detach?: boolean; json?: boolean; config?: string; context?: string[] },
  project?: { name: string; path: string; branch?: string; remote?: string }
): Promise<void> => {
  const config = opts.config ? (JSON.parse(opts.config) as Record<string, unknown>) : undefined;

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
    console.error(chalk.red("Not connected to hub. Run 'agentage login' first."));
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
