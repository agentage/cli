import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import { loadConfig, saveConfig } from '../daemon/config.js';
import { registerConfig } from './config-cmd.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);

describe('config command', () => {
  let program: Command;
  let logs: string[];

  const defaultConfig = {
    machine: { id: 'machine-123', name: 'test-host' },
    daemon: { port: 4243 },
    discovery: { dirs: ['/home/user/.agentage/agents'] },
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
    registerConfig(program);
  });

  describe('list', () => {
    it('lists all config as key=value pairs', async () => {
      await program.parseAsync(['node', 'agentage', 'config', 'list']);

      expect(logs.some((l) => l.includes('machine.id=machine-123'))).toBe(true);
      expect(logs.some((l) => l.includes('machine.name=test-host'))).toBe(true);
      expect(logs.some((l) => l.includes('daemon.port=4243'))).toBe(true);
    });

    it('outputs JSON with --json', async () => {
      await program.parseAsync(['node', 'agentage', 'config', 'list', '--json']);

      const parsed = JSON.parse(logs[0]!);
      expect(parsed.machine.name).toBe('test-host');
      expect(parsed.daemon.port).toBe(4243);
    });
  });

  describe('set', () => {
    it('sets a config value with dot notation', async () => {
      await program.parseAsync(['node', 'agentage', 'config', 'set', 'daemon.port', '5000']);

      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
      const saved = mockSaveConfig.mock.calls[0]![0];
      expect(saved.daemon.port).toBe(5000);
      expect(logs.some((l) => l.includes('Set daemon.port=5000'))).toBe(true);
    });

    it('sets a string value', async () => {
      await program.parseAsync(['node', 'agentage', 'config', 'set', 'machine.name', 'new-host']);

      const saved = mockSaveConfig.mock.calls[0]![0];
      expect(saved.machine.name).toBe('new-host');
    });

    it('sets a boolean value', async () => {
      await program.parseAsync(['node', 'agentage', 'config', 'set', 'sync.events.state', 'false']);

      const saved = mockSaveConfig.mock.calls[0]![0];
      expect(saved.sync.events.state).toBe(false);
    });
  });
});
