import { type Command } from 'commander';
import chalk from 'chalk';
import { type RunEvent } from '@agentage/core';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { connectWs, post } from '../utils/daemon-client.js';
import { renderEvent } from '../utils/render.js';

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

export const registerRun = (program: Command): void => {
  program
    .command('run')
    .argument('<agent>', 'Agent name')
    .argument('[prompt]', 'Task/prompt for the agent')
    .description('Run an agent')
    .option('-d, --detach', 'Run in background, print run ID')
    .option('--json', 'Output events as JSON lines')
    .option('--config <json>', 'Per-run config overrides (JSON)')
    .option('--context <paths...>', 'Additional context files')
    .action(
      async (
        agent: string,
        prompt: string | undefined,
        opts: { detach?: boolean; json?: boolean; config?: string; context?: string[] }
      ) => {
        await ensureDaemon();

        if (!prompt) {
          console.error(chalk.red('Prompt is required. Usage: agentage run <agent> "<prompt>"'));
          process.exitCode = 1;
          return;
        }

        const config = opts.config
          ? (JSON.parse(opts.config) as Record<string, unknown>)
          : undefined;

        const { runId } = await post<RunResponse>(`/api/agents/${agent}/run`, {
          task: prompt,
          config,
          context: opts.context,
        });

        if (opts.detach) {
          console.log(runId);
          return;
        }

        // Stream events via WebSocket
        await streamRun(runId, opts.json ?? false);
      }
    );
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
