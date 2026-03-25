import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../utils/daemon-client.js', () => ({
  get: vi.fn(),
}));

import { get } from '../utils/daemon-client.js';
import { registerMachines } from './machines.js';

const mockGet = vi.mocked(get);

describe('machines command', () => {
  let program: Command;
  let logs: string[];
  let errorLogs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    errorLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerMachines(program);
  });

  it('lists machines from hub', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'm-1',
        name: 'dev-laptop',
        platform: 'linux',
        status: 'online',
        last_seen_at: new Date().toISOString(),
      },
    ]);

    await program.parseAsync(['node', 'agentage', 'machines']);

    expect(mockGet).toHaveBeenCalledWith('/api/hub/machines');
    expect(logs.some((l) => l.includes('dev-laptop'))).toBe(true);
    expect(logs.some((l) => l.includes('linux'))).toBe(true);
  });

  it('outputs JSON with --json', async () => {
    const machines = [
      { id: 'm-1', name: 'pc', platform: 'linux', status: 'online', last_seen_at: '2026-01-01T00:00:00Z' },
    ];
    mockGet.mockResolvedValue(machines);

    await program.parseAsync(['node', 'agentage', 'machines', '--json']);

    expect(logs[0]).toBe(JSON.stringify(machines, null, 2));
  });

  it('shows error when not connected to hub', async () => {
    mockGet.mockRejectedValue(new Error('Unauthorized'));

    await program.parseAsync(['node', 'agentage', 'machines']);

    expect(errorLogs.some((l) => l.includes('Not connected to hub'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('prints message when no machines', async () => {
    mockGet.mockResolvedValue([]);

    await program.parseAsync(['node', 'agentage', 'machines']);

    expect(logs.some((l) => l.includes('No machines registered'))).toBe(true);
  });

  it('formats last seen as just now for recent machines', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'm-1',
        name: 'fresh',
        platform: 'darwin',
        status: 'online',
        last_seen_at: new Date().toISOString(),
      },
    ]);

    await program.parseAsync(['node', 'agentage', 'machines']);

    expect(logs.some((l) => l.includes('just now'))).toBe(true);
  });

  it('shows offline status for offline machines', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'm-2',
        name: 'old-server',
        platform: 'linux',
        status: 'offline',
        last_seen_at: new Date(Date.now() - 7200000).toISOString(),
      },
    ]);

    await program.parseAsync(['node', 'agentage', 'machines']);

    expect(logs.some((l) => l.includes('offline'))).toBe(true);
    expect(logs.some((l) => l.includes('2h ago'))).toBe(true);
  });
});
