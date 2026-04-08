import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../utils/daemon-client.js', () => ({
  get: vi.fn(),
}));

vi.mock('../daemon/daemon.js', () => ({
  getDaemonPid: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';
import { loadConfig, saveConfig } from '../daemon/config.js';
import { registerStatus } from './status.js';

const mockGet = vi.mocked(get);
const mockGetDaemonPid = vi.mocked(getDaemonPid);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);

describe('status command', () => {
  let program: Command;
  let logs: string[];
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  const defaultConfig = {
    machine: { id: 'machine-123', name: 'test-host' },
    daemon: { port: 4243 },
    discovery: {
      dirs: ['/home/user/.agentage/agents', '/home/user/.agentage/skills'],
    },
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
    registerStatus(program);
  });

  const baseHealth = {
    status: 'ok',
    version: '0.7.1',
    uptime: 3661,
    machineId: 'machine-123',
    hubConnected: false,
    hubConnecting: false,
    hubUrl: null,
    userEmail: null,
  };

  it('displays daemon info with hub connected', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health')
        return {
          ...baseHealth,
          hubConnected: true,
          hubUrl: 'https://agentage.io',
          userEmail: 'v@test.com',
        };
      if (path === '/api/agents') return [{}, {}];
      return [{}, {}, {}];
    });
    mockGetDaemonPid.mockReturnValue(1234);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('1234'))).toBe(true);
    expect(logs.some((l) => l.includes('1h 1m'))).toBe(true);
    expect(logs.some((l) => l.includes('connected'))).toBe(true);
    expect(logs.some((l) => l.includes('v@test.com'))).toBe(true);
    expect(logs.some((l) => l.includes('2 discovered'))).toBe(true);
    expect(logs.some((l) => l.includes('3 active'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('displays standalone mode when no hub', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return baseHealth;
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('standalone mode'))).toBe(true);
  });

  it('displays disconnected when hubUrl set but not connected', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health')
        return { ...baseHealth, hubUrl: 'https://agentage.io', userEmail: 'v@test.com' };
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('disconnected'))).toBe(true);
  });

  it('displays connecting when hub connection is in progress', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health')
        return {
          ...baseHealth,
          hubConnecting: true,
          hubUrl: 'https://agentage.io',
          userEmail: 'v@test.com',
        };
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('connecting'))).toBe(true);
    expect(logs.some((l) => l.includes('v@test.com'))).toBe(true);
  });

  it('formats uptime as minutes only', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return { ...baseHealth, uptime: 120 };
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('2m'))).toBe(true);
  });

  it('formats uptime as seconds only', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return { ...baseHealth, uptime: 45 };
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('45s'))).toBe(true);
  });

  it('displays discovery directories in status output', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return baseHealth;
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('Discovery:'))).toBe(true);
    expect(logs.some((l) => l.includes('/home/user/.agentage/agents'))).toBe(true);
    expect(logs.some((l) => l.includes('/home/user/.agentage/skills'))).toBe(true);
  });

  it('--add-dir adds a new directory to config', async () => {
    await program.parseAsync(['node', 'agentage', 'status', '--add-dir', '/tmp/new-agents']);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.discovery.dirs).toContain('/tmp/new-agents');
    expect(logs.some((l) => l.includes('Added discovery directory'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--add-dir with duplicate path does not add twice', async () => {
    await program.parseAsync([
      'node',
      'agentage',
      'status',
      '--add-dir',
      '/home/user/.agentage/agents',
    ]);

    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('already in discovery'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--remove-dir removes a directory from config', async () => {
    await program.parseAsync([
      'node',
      'agentage',
      'status',
      '--remove-dir',
      '/home/user/.agentage/agents',
    ]);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.discovery.dirs).not.toContain('/home/user/.agentage/agents');
    expect(savedConfig.discovery.dirs).toContain('/home/user/.agentage/skills');
    expect(logs.some((l) => l.includes('Removed discovery directory'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('outputs JSON with --json', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health')
        return {
          ...baseHealth,
          hubConnected: true,
          hubUrl: 'https://agentage.io',
          userEmail: 'v@test.com',
        };
      if (path === '/api/agents') return [{}, {}];
      return [{}, {}, {}];
    });
    mockGetDaemonPid.mockReturnValue(1234);

    await program.parseAsync(['node', 'agentage', 'status', '--json']);

    const parsed = JSON.parse(logs[0]!);
    expect(parsed.daemon.status).toBe('running');
    expect(parsed.daemon.pid).toBe(1234);
    expect(parsed.hub.connected).toBe(true);
    expect(parsed.hub.url).toBe('https://agentage.io');
    expect(parsed.agents).toBe(2);
    expect(parsed.runs).toBe(3);
    expect(parsed.discoveryDirs).toHaveLength(2);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--remove-dir with non-existent path is graceful', async () => {
    await program.parseAsync(['node', 'agentage', 'status', '--remove-dir', '/nonexistent/path']);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.discovery.dirs).toHaveLength(2);
    expect(logs.some((l) => l.includes('Removed discovery directory'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
