import { describe, expect, it, vi } from 'vitest';
import { createRegistry, output, result, type InvokeEvent } from '@agentage/core';
import { createAgentInstallAction } from './agent-install.js';
import { createCliUpdateAction } from './cli-update.js';
import { createProjectAddFromOriginAction } from './project-add-from-origin.js';
import type { ShellExec } from './types.js';

const fakeShell = (success = true, observe?: (cmd: string) => void): ShellExec =>
  async function* (command) {
    observe?.(command);
    yield output(`running: ${command}`);
    yield result(success, success ? 'ok' : 'fail');
  };

const collect = async (gen: AsyncGenerator<InvokeEvent>): Promise<InvokeEvent[]> => {
  const events: InvokeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
};

describe('cli-update', () => {
  it('installs target version and returns bump envelope', async () => {
    const observed: string[] = [];
    const reg = createRegistry();
    reg.register(
      createCliUpdateAction({
        shell: fakeShell(true, (c) => observed.push(c)),
        readCurrentVersion: async () => '0.17.0',
      })
    );
    const events = await collect(
      reg.invoke({
        action: 'cli:update',
        input: { target: '0.18.0' },
        callerId: 'test',
        capabilities: ['cli.write'],
      })
    );
    expect(observed).toEqual(['npm install -g @agentage/cli@0.18.0']);
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      data: { installed: '0.18.0', from: '0.17.0' },
    });
  });

  it('rejects non-semver target', async () => {
    const reg = createRegistry();
    reg.register(
      createCliUpdateAction({ shell: fakeShell(), readCurrentVersion: async () => '0.17.0' })
    );
    const events = await collect(
      reg.invoke({
        action: 'cli:update',
        input: { target: 'master' },
        callerId: 'test',
        capabilities: ['cli.write'],
      })
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
  });
});

describe('project-add-from-origin', () => {
  it('derives project name from remote and passes branch flag', async () => {
    const spy = vi.fn();
    const reg = createRegistry();
    reg.register(createProjectAddFromOriginAction({ shell: fakeShell(true, spy) }));
    await collect(
      reg.invoke({
        action: 'project:addFromOrigin',
        input: {
          remote: 'git@github.com:agentage/cli.git',
          parentDir: '/tmp/projects',
          branch: 'develop',
        },
        callerId: 'test',
        capabilities: ['project.write'],
      })
    );
    expect(spy).toHaveBeenCalledWith(
      'git clone -b develop git@github.com:agentage/cli.git /tmp/projects/cli'
    );
  });
});

describe('agent-install', () => {
  it('runs npm install in workspaceDir', async () => {
    const spy = vi.fn();
    const reg = createRegistry();
    reg.register(createAgentInstallAction({ shell: fakeShell(true, spy) }));
    const events = await collect(
      reg.invoke({
        action: 'agent:install',
        input: { spec: '@agentage/agent-pr@1.0.0', workspaceDir: '/home/me/agents' },
        callerId: 'test',
        capabilities: ['agent.write'],
      })
    );
    expect(spy).toHaveBeenCalledWith('npm install @agentage/agent-pr@1.0.0');
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      data: { spec: '@agentage/agent-pr@1.0.0' },
    });
  });

  it('emits EXECUTION_FAILED when install fails', async () => {
    const reg = createRegistry();
    reg.register(createAgentInstallAction({ shell: fakeShell(false) }));
    const events = await collect(
      reg.invoke({
        action: 'agent:install',
        input: { spec: 'bad-pkg', workspaceDir: '/tmp' },
        callerId: 'test',
        capabilities: ['agent.write'],
      })
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'EXECUTION_FAILED' });
  });
});
