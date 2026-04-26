import { describe, expect, it, vi } from 'vitest';
import { createSettingsUpdateAction } from './settings-update.js';
import type { DaemonConfig } from '../config.js';

const baseConfig = (): DaemonConfig => ({
  machine: { id: 'm1', name: 'host' },
  daemon: { port: 4243 },
  agents: { default: '/old/agents', additional: [] },
  projects: { default: '/old/projects', additional: [] },
  vaultsDefault: '/old/vaults',
  sync: {
    events: {
      state: true,
      result: true,
      error: true,
      input_required: true,
      'output.llm.delta': true,
      'output.llm.tool_call': true,
      'output.llm.usage': true,
      'output.progress': true,
    },
  },
});

const drain = async <T>(gen: AsyncGenerator<unknown, T, void>): Promise<T> => {
  while (true) {
    const next = await gen.next();
    if (next.done) return next.value;
  }
};

const makeCtx = () => ({
  invocationId: 'inv-1',
  callerId: 'hub',
  capabilities: new Set<string>(),
  signal: new AbortController().signal,
});

describe('settings:update action', () => {
  it('writes only the keys provided in input — preserves the rest', async () => {
    const cfg = baseConfig();
    const writeSpy = vi.fn();
    const def = createSettingsUpdateAction({ loadConfig: () => cfg, saveConfig: writeSpy });

    const result = await drain(def.execute(makeCtx(), { agents_default: '/new/agents' }));

    expect(result).toEqual({
      agents_default: '/new/agents',
      projects_default: '/old/projects',
      vaults_default: '/old/vaults',
    });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = writeSpy.mock.calls[0][0] as DaemonConfig;
    expect(written.agents.default).toBe('/new/agents');
    expect(written.projects.default).toBe('/old/projects');
    expect(written.vaultsDefault).toBe('/old/vaults');
    // Sanity: didn't drop unrelated fields.
    expect(written.machine).toEqual(cfg.machine);
    expect(written.daemon).toEqual(cfg.daemon);
  });

  it('updates all three fields when all are provided', async () => {
    const writeSpy = vi.fn();
    const def = createSettingsUpdateAction({ loadConfig: baseConfig, saveConfig: writeSpy });

    const result = await drain(
      def.execute(makeCtx(), {
        agents_default: '/a',
        projects_default: '/p',
        vaults_default: '/v',
      })
    );

    expect(result).toEqual({ agents_default: '/a', projects_default: '/p', vaults_default: '/v' });
    const written = writeSpy.mock.calls[0][0] as DaemonConfig;
    expect(written.agents.default).toBe('/a');
    expect(written.projects.default).toBe('/p');
    expect(written.vaultsDefault).toBe('/v');
  });

  it('rejects empty input — must include at least one key', () => {
    const def = createSettingsUpdateAction();
    expect(() => def.validateInput!({})).toThrow(/at least one of/);
  });

  it('rejects non-string values for any field', () => {
    const def = createSettingsUpdateAction();
    expect(() => def.validateInput!({ agents_default: 123 })).toThrow(/non-empty string/);
    expect(() => def.validateInput!({ vaults_default: '' })).toThrow(/non-empty string/);
  });

  it('surfaces saveConfig failure as EXECUTION_FAILED ActionError', async () => {
    const def = createSettingsUpdateAction({
      loadConfig: baseConfig,
      saveConfig: () => {
        throw new Error('disk full');
      },
    });

    await expect(drain(def.execute(makeCtx(), { agents_default: '/x' }))).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      retryable: true,
    });
  });
});
