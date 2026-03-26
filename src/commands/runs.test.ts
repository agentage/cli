import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../utils/daemon-client.js', () => ({
  get: vi.fn(),
}));

import { get } from '../utils/daemon-client.js';
import { registerRuns } from './runs.js';

const mockGet = vi.mocked(get);

describe('runs command', () => {
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
    registerRuns(program);
  });

  it('lists local runs with table format', async () => {
    const now = Date.now();
    mockGet.mockResolvedValue([
      {
        id: 'abcdef1234567890',
        agentName: 'hello',
        state: 'completed',
        startedAt: now - 30000,
        endedAt: now - 25000,
      },
    ]);

    await program.parseAsync(['node', 'agentage', 'runs']);

    expect(mockGet).toHaveBeenCalledWith('/api/runs');
    // Header row
    expect(logs[0]).toContain('ID');
    expect(logs[0]).toContain('AGENT');
    // Data row
    expect(logs[1]).toContain('abcdef12');
    expect(logs[1]).toContain('hello');
    expect(logs[1]).toContain('completed');
  });

  it('outputs JSON with --json', async () => {
    const runs = [{ id: 'run-1', agentName: 'test', state: 'working', startedAt: Date.now() }];
    mockGet.mockResolvedValue(runs);

    await program.parseAsync(['node', 'agentage', 'runs', '--json']);

    expect(logs[0]).toBe(JSON.stringify(runs, null, 2));
  });

  it('prints message when no runs', async () => {
    mockGet.mockResolvedValue([]);

    await program.parseAsync(['node', 'agentage', 'runs']);

    expect(logs.some((l) => l.includes('No runs'))).toBe(true);
  });

  it('shows error for --all (not connected)', async () => {
    await program.parseAsync(['node', 'agentage', 'runs', '--all']);

    expect(errorLogs.some((l) => l.includes('Not connected to hub'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('displays duration for completed runs', async () => {
    const now = Date.now();
    mockGet.mockResolvedValue([
      {
        id: 'run-123456789abc',
        agentName: 'worker',
        state: 'completed',
        startedAt: now - 90000,
        endedAt: now - 5000,
      },
    ]);

    await program.parseAsync(['node', 'agentage', 'runs']);

    // 85 seconds = 1m 25s
    expect(logs[1]).toContain('1m 25s');
  });

  it('shows dash for duration when run has no endedAt', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'run-working12345',
        agentName: 'active',
        state: 'working',
        startedAt: Date.now() - 5000,
        endedAt: undefined,
      },
    ]);

    await program.parseAsync(['node', 'agentage', 'runs']);

    // duration column should show —
    const dataLine = logs[1];
    expect(dataLine).toContain('\u2014');
  });

  it('shows run count at bottom', async () => {
    const now = Date.now();
    mockGet.mockResolvedValue([
      { id: 'run-1aaaaaa', agentName: 'a', state: 'completed', startedAt: now, endedAt: now },
      { id: 'run-2bbbbbbb', agentName: 'b', state: 'working', startedAt: now },
    ]);

    await program.parseAsync(['node', 'agentage', 'runs']);

    expect(logs.some((l) => l.includes('2 runs'))).toBe(true);
  });

  describe('--filter', () => {
    it('filters runs by state', async () => {
      const now = Date.now();
      mockGet.mockResolvedValue([
        { id: 'run-1aaaaaa', agentName: 'a', state: 'completed', startedAt: now, endedAt: now },
        { id: 'run-2bbbbbbb', agentName: 'b', state: 'working', startedAt: now },
        { id: 'run-3ccccccc', agentName: 'c', state: 'failed', startedAt: now, endedAt: now },
      ]);

      await program.parseAsync(['node', 'agentage', 'runs', '--filter', 'working']);

      // Should only show the working run
      expect(logs.some((l) => l.includes('run-2bbb'))).toBe(true);
      expect(logs.some((l) => l.includes('run-1aaa'))).toBe(false);
      expect(logs.some((l) => l.includes('1 runs'))).toBe(true);
    });

    it('shows no runs when filter matches nothing', async () => {
      mockGet.mockResolvedValue([
        { id: 'run-1aaaaaa', agentName: 'a', state: 'completed', startedAt: Date.now() },
      ]);

      await program.parseAsync(['node', 'agentage', 'runs', '--filter', 'failed']);

      expect(logs.some((l) => l.includes('No runs'))).toBe(true);
    });

    it('applies filter before --json output', async () => {
      const now = Date.now();
      mockGet.mockResolvedValue([
        { id: 'run-1', agentName: 'a', state: 'completed', startedAt: now },
        { id: 'run-2', agentName: 'b', state: 'working', startedAt: now },
      ]);

      await program.parseAsync(['node', 'agentage', 'runs', '--filter', 'completed', '--json']);

      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].state).toBe('completed');
    });
  });

  describe('--last', () => {
    it('shows only last N runs', async () => {
      const now = Date.now();
      mockGet.mockResolvedValue([
        { id: 'run-1aaaaaa', agentName: 'a', state: 'completed', startedAt: now },
        { id: 'run-2bbbbbbb', agentName: 'b', state: 'working', startedAt: now },
        { id: 'run-3ccccccc', agentName: 'c', state: 'failed', startedAt: now },
      ]);

      await program.parseAsync(['node', 'agentage', 'runs', '--last', '1']);

      // Should show only the last run
      expect(logs.some((l) => l.includes('run-3ccc'))).toBe(true);
      expect(logs.some((l) => l.includes('run-1aaa'))).toBe(false);
    });

    it('applies --last to --json output', async () => {
      const now = Date.now();
      mockGet.mockResolvedValue([
        { id: 'run-1', agentName: 'a', state: 'completed', startedAt: now },
        { id: 'run-2', agentName: 'b', state: 'working', startedAt: now },
      ]);

      await program.parseAsync(['node', 'agentage', 'runs', '--last', '1', '--json']);

      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('run-2');
    });
  });
});
