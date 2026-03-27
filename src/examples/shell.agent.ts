import { createAgent, type RunEvent } from '@agentage/core';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const agent = createAgent({
  name: 'shell',
  description: 'Executes a shell command and streams output',
  version: '1.0.0',
  tags: ['example', 'shell'],
  path: '',
  async *run(input, { signal }) {
    if (!input.task.trim()) {
      yield {
        type: 'error' as const,
        data: {
          type: 'error' as const,
          code: 'EMPTY_COMMAND',
          message: 'No command provided',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
      yield {
        type: 'result' as const,
        data: { type: 'result' as const, success: false, output: 'No command provided' },
        timestamp: Date.now(),
      };
      return;
    }

    const events: RunEvent[] = [];
    let exitCode: number | null = null;

    await new Promise<void>((resolve) => {
      const proc = spawn(input.task, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

      const onAbort = (): void => {
        proc.kill();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      if (proc.stdout) {
        const rl = createInterface({ input: proc.stdout });
        rl.on('line', (line) => {
          events.push({
            type: 'output',
            data: { type: 'output', content: line, format: 'text' },
            timestamp: Date.now(),
          });
        });
      }

      if (proc.stderr) {
        const rl = createInterface({ input: proc.stderr });
        rl.on('line', (line) => {
          events.push({
            type: 'error',
            data: { type: 'error', code: 'STDERR', message: line, recoverable: true },
            timestamp: Date.now(),
          });
        });
      }

      proc.on('error', (err) => {
        events.push({
          type: 'error',
          data: { type: 'error', code: 'SPAWN_ERROR', message: err.message, recoverable: false },
          timestamp: Date.now(),
        });
        resolve();
      });

      proc.on('close', (code) => {
        exitCode = code;
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });

    for (const event of events) {
      yield event;
    }

    if (!signal.aborted) {
      yield {
        type: 'result' as const,
        data: {
          type: 'result' as const,
          success: exitCode === 0,
          output: exitCode === 0 ? 'Command completed' : `Exited with code ${exitCode}`,
        },
        timestamp: Date.now(),
      };
    }
  },
});

export default agent;
