import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { ActionProgress, ShellExec } from './types.js';

export interface CliUpdateInput {
  target: string;
  via?: 'npm';
}

export interface CliUpdateOutput {
  installed: string;
  from: string;
  command: string;
}

const SEMVER_OR_LATEST = /^(?:latest|\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

const validate = (raw: unknown): CliUpdateInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const { target, via } = raw as { target?: unknown; via?: unknown };
  if (typeof target !== 'string' || !SEMVER_OR_LATEST.test(target)) {
    throw new Error('target must be "latest" or a semver string like "1.2.3"');
  }
  if (via !== undefined && via !== 'npm') throw new Error('via must be "npm" when set');
  return { target, via: 'npm' };
};

export const createCliUpdateAction = (deps: {
  shell: ShellExec;
  readCurrentVersion: () => Promise<string>;
}): ActionDefinition<CliUpdateInput, CliUpdateOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'cli:update',
      version: '1.0',
      title: 'Update CLI',
      description: 'Install a specific version of @agentage/cli globally via npm',
      scope: 'machine',
      capability: 'cli.write',
      idempotent: false,
    },
    validateInput: validate,
    async *execute(ctx, input): AsyncGenerator<ActionProgress, CliUpdateOutput, void> {
      const from = await deps.readCurrentVersion();
      yield { step: 'resolve', detail: `current=${from} target=${input.target}` };

      const pkg =
        input.target === 'latest' ? '@agentage/cli@latest' : `@agentage/cli@${input.target}`;
      const command = `npm install -g ${pkg}`;
      yield { step: 'install', detail: command };

      let lastError: string | undefined;
      for await (const event of deps.shell(command, { signal: ctx.signal })) {
        if (event.data.type === 'error') {
          lastError = `${event.data.code}: ${event.data.message}`;
        }
        if (event.data.type === 'result' && !event.data.success) {
          throw new ActionError('EXECUTION_FAILED', lastError ?? 'npm install failed', true);
        }
      }

      return { installed: input.target, from, command };
    },
  });
