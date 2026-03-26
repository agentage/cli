import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

import { loadConfig, saveConfig } from '../daemon/config.js';
import { registerInit } from './init.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);

describe('init command', () => {
  let program: Command;
  let logs: string[];

  const defaultConfig = {
    machine: { id: 'machine-123', name: 'test-host' },
    daemon: { port: 4243 },
    discovery: { dirs: [] },
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    mockLoadConfig.mockReturnValue(structuredClone(defaultConfig));

    program = new Command();
    program.exitOverride();
    registerInit(program);
  });

  it('sets machine name with --name', async () => {
    await program.parseAsync(['node', 'agentage', 'init', '--name', 'my-pc']);

    const saved = mockSaveConfig.mock.calls[0]![0];
    expect(saved.machine.name).toBe('my-pc');
    expect(logs.some((l) => l.includes('Agentage initialized'))).toBe(true);
    expect(logs.some((l) => l.includes('Machine name: my-pc'))).toBe(true);
  });

  it('adds discovery dir with --dir', async () => {
    await program.parseAsync(['node', 'agentage', 'init', '--dir', '/tmp/agents']);

    const saved = mockSaveConfig.mock.calls[0]![0];
    expect(saved.discovery.dirs).toContain('/tmp/agents');
    expect(logs.some((l) => l.includes('Discovery dir:'))).toBe(true);
  });

  it('sets hub URL with --hub', async () => {
    await program.parseAsync(['node', 'agentage', 'init', '--hub', 'https://my.hub']);

    const saved = mockSaveConfig.mock.calls[0]![0];
    expect(saved.hub).toEqual({ url: 'https://my.hub' });
    expect(logs.some((l) => l.includes('Hub URL: https://my.hub'))).toBe(true);
  });

  it('auto-prepends https for hub URL without protocol', async () => {
    await program.parseAsync(['node', 'agentage', 'init', '--hub', 'my.hub']);

    const saved = mockSaveConfig.mock.calls[0]![0];
    expect(saved.hub).toEqual({ url: 'https://my.hub' });
  });

  it('shows login hint when hub provided without --no-login', async () => {
    await program.parseAsync(['node', 'agentage', 'init', '--hub', 'https://my.hub']);

    expect(logs.some((l) => l.includes('agentage login'))).toBe(true);
  });

  it('skips login hint with --no-login', async () => {
    await program.parseAsync(['node', 'agentage', 'init', '--hub', 'https://my.hub', '--no-login']);

    expect(logs.some((l) => l.includes('agentage login'))).toBe(false);
  });

  it('shows daemon started in summary', async () => {
    await program.parseAsync(['node', 'agentage', 'init']);

    expect(logs.some((l) => l.includes('Daemon: started'))).toBe(true);
  });
});
