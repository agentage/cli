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

vi.mock('../projects/projects.js', () => ({
  loadProjects: vi.fn(),
}));

vi.mock('../utils/update-checker.js', () => ({
  checkForUpdateSafe: vi.fn(),
}));

import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';
import { loadConfig, saveConfig } from '../daemon/config.js';
import { loadProjects } from '../projects/projects.js';
import { checkForUpdateSafe } from '../utils/update-checker.js';
import { registerStatus } from './status.js';

const mockLoadProjects = vi.mocked(loadProjects);
const mockCheckForUpdateSafe = vi.mocked(checkForUpdateSafe);

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
    agents: {
      default: '/home/user/agents',
      additional: ['/home/user/.agentage/skills'],
    },
    projects: {
      default: '/home/user/projects',
      additional: [],
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
    mockLoadProjects.mockReturnValue([]);
    mockCheckForUpdateSafe.mockResolvedValue(null);

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

  it('displays projects count in status', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return baseHealth;
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);
    mockLoadProjects.mockReturnValue([
      { name: 'proj-a', path: '/a', discovered: false },
      { name: 'proj-b', path: '/b', discovered: true },
    ]);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('Projects:') && l.includes('2 registered'))).toBe(true);
  });

  it('includes projects in JSON output', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return baseHealth;
      if (path === '/api/agents') return [{}];
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);
    mockLoadProjects.mockReturnValue([{ name: 'p', path: '/p', discovered: false }]);

    await program.parseAsync(['node', 'agentage', 'status', '--json']);

    const parsed = JSON.parse(logs[0]!);
    expect(parsed.projects).toBe(1);
  });

  it('displays update hint when a newer version is available', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return baseHealth;
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);
    mockCheckForUpdateSafe.mockResolvedValue({
      currentVersion: '0.13.1',
      latestVersion: '0.14.0',
      updateAvailable: true,
    });

    await program.parseAsync(['node', 'agentage', 'status']);

    const versionLine = logs.find((l) => l.includes('Version:'));
    expect(versionLine).toBeDefined();
    expect(versionLine).toContain('0.14.0 available');
    expect(versionLine).toContain('agentage update');
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

  it('displays agent dirs in status output', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/health') return baseHealth;
      return [];
    });
    mockGetDaemonPid.mockReturnValue(42);

    await program.parseAsync(['node', 'agentage', 'status']);

    expect(logs.some((l) => l.includes('/home/user/agents'))).toBe(true);
    expect(logs.some((l) => l.includes('/home/user/.agentage/skills'))).toBe(true);
    expect(logs.some((l) => l.includes('/home/user/projects'))).toBe(true);
  });

  it('--add-dir adds a new directory to agents.additional', async () => {
    await program.parseAsync(['node', 'agentage', 'status', '--add-dir', '/tmp/new-agents']);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.agents.additional).toContain('/tmp/new-agents');
    expect(logs.some((l) => l.includes('Added agents directory'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--add-dir with duplicate path does not add twice', async () => {
    await program.parseAsync([
      'node',
      'agentage',
      'status',
      '--add-dir',
      '/home/user/.agentage/skills',
    ]);

    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('already configured'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--add-dir rejects path matching agents.default as duplicate', async () => {
    await program.parseAsync(['node', 'agentage', 'status', '--add-dir', '/home/user/agents']);

    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('already configured'))).toBe(true);
  });

  it('--remove-dir removes from agents.additional', async () => {
    await program.parseAsync([
      'node',
      'agentage',
      'status',
      '--remove-dir',
      '/home/user/.agentage/skills',
    ]);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.agents.additional).not.toContain('/home/user/.agentage/skills');
    expect(savedConfig.agents.default).toBe('/home/user/agents');
    expect(logs.some((l) => l.includes('Removed agents directory'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--remove-dir refuses to remove agents.default', async () => {
    const mockExitErr = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errLogs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errLogs.push(args.map(String).join(' '));
    });

    await program.parseAsync(['node', 'agentage', 'status', '--remove-dir', '/home/user/agents']);

    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(errLogs.some((l) => l.includes('Cannot remove default'))).toBe(true);
    expect(mockExitErr).toHaveBeenCalledWith(1);
  });

  it('--set-default swaps default and demotes old default to additional', async () => {
    await program.parseAsync(['node', 'agentage', 'status', '--set-default', '/tmp/new-default']);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.agents.default).toBe('/tmp/new-default');
    expect(savedConfig.agents.additional).toContain('/home/user/agents');
    expect(logs.some((l) => l.includes('Set agents default'))).toBe(true);
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
    expect(parsed.agentsDefault).toBe('/home/user/agents');
    expect(parsed.agentsAdditional).toEqual(['/home/user/.agentage/skills']);
    expect(parsed.projectsDefault).toBe('/home/user/projects');
    expect(parsed.projectsAdditional).toEqual([]);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('--remove-dir with non-existent path is graceful', async () => {
    await program.parseAsync(['node', 'agentage', 'status', '--remove-dir', '/nonexistent/path']);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0]![0];
    expect(savedConfig.agents.additional).toHaveLength(1);
    expect(logs.some((l) => l.includes('Removed agents directory'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
