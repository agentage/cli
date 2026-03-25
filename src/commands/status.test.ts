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

import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';
import { registerStatus } from './status.js';

const mockGet = vi.mocked(get);
const mockGetDaemonPid = vi.mocked(getDaemonPid);

describe('status command', () => {
  let program: Command;
  let logs: string[];
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

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
});
