import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { ActionProgress, ShellExec } from './types.js';

export interface ProjectAddInput {
  remote: string;
  parentDir: string;
  branch?: string;
  name?: string;
}

export interface ProjectAddOutput {
  name: string;
  path: string;
  remote: string;
  branch: string;
}

const REMOTE = /^(?:git@|https?:\/\/)[\w.@:/\-~]+\.git$/;

const deriveName = (remote: string): string => {
  const match = /([^/]+?)(?:\.git)?$/.exec(remote);
  if (!match?.[1]) throw new Error(`cannot derive name from remote: ${remote}`);
  return match[1];
};

const validate = (raw: unknown): ProjectAddInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const { remote, parentDir, branch, name } = raw as Record<string, unknown>;
  if (typeof remote !== 'string' || !REMOTE.test(remote)) {
    throw new Error('remote must be a valid git URL (git@ or https://, ending in .git)');
  }
  if (typeof parentDir !== 'string' || !parentDir.startsWith('/')) {
    throw new Error('parentDir must be an absolute path');
  }
  if (branch !== undefined && typeof branch !== 'string') throw new Error('branch must be string');
  if (name !== undefined && typeof name !== 'string') throw new Error('name must be string');
  return { remote, parentDir, branch, name };
};

export const createProjectAddFromOriginAction = (deps: {
  shell: ShellExec;
}): ActionDefinition<ProjectAddInput, ProjectAddOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'project:addFromOrigin',
      version: '1.0',
      title: 'Add project from git remote',
      description: 'Clone a git remote into parentDir and register as a project',
      scope: 'machine',
      capability: 'project.write',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(ctx, input): AsyncGenerator<ActionProgress, ProjectAddOutput, void> {
      const name = input.name ?? deriveName(input.remote);
      const path = `${input.parentDir.replace(/\/$/, '')}/${name}`;
      const branchFlag = input.branch ? ` -b ${input.branch}` : '';
      const command = `git clone${branchFlag} ${input.remote} ${path}`;
      yield { step: 'clone', detail: command };

      let failed = false;
      for await (const event of deps.shell(command, { signal: ctx.signal })) {
        if (event.data.type === 'result' && !event.data.success) failed = true;
      }
      if (failed) throw new ActionError('EXECUTION_FAILED', `git clone failed: ${command}`, true);

      yield { step: 'register', detail: path };
      return { name, path, remote: input.remote, branch: input.branch ?? 'default' };
    },
  });
