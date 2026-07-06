import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as lifecycle from '../daemon/lifecycle.js';
import * as dc from '../lib/daemon-client.js';
import { registerDaemon } from './daemon-cmd.js';

vi.mock('../daemon/lifecycle.js');
vi.mock('../lib/daemon-client.js');

const health = (over: Partial<dc.Health> = {}): dc.Health => ({
  ok: true,
  version: '1.2.3',
  pid: 4242,
  uptime: 12,
  served: 7,
  ...over,
});

let logs: string[];

const run = async (args: string[]): Promise<void> => {
  const program = new Command();
  program.exitOverride();
  registerDaemon(program);
  await program.parseAsync(['node', 'agentage', ...args]);
};

beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => void logs.push(String(m)));
  vi.mocked(lifecycle.resolvePort).mockReturnValue(45000);
  vi.mocked(dc.mismatchNotice).mockReturnValue(null);
  process.exitCode = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('daemon status', () => {
  it('reports not running when no pidfile is live', async () => {
    vi.mocked(lifecycle.isDaemonRunning).mockReturnValue(false);
    await run(['daemon', 'status']);
    expect(logs.join()).toContain('not running');
  });

  it('prints pid, port, uptime, served, and version', async () => {
    vi.mocked(lifecycle.isDaemonRunning).mockReturnValue(true);
    vi.mocked(dc.health).mockResolvedValue(health());
    await run(['daemon', 'status']);
    const out = logs.join('\n');
    expect(out).toContain('4242');
    expect(out).toContain('45000');
    expect(out).toContain('served   7');
    expect(out).toContain('1.2.3');
  });

  it('appends a restart hint on a version mismatch', async () => {
    vi.mocked(lifecycle.isDaemonRunning).mockReturnValue(true);
    vi.mocked(dc.health).mockResolvedValue(health());
    vi.mocked(dc.mismatchNotice).mockReturnValue('daemon version 1.2.3 != cli 9; restart');
    await run(['daemon', 'status']);
    expect(logs.join('\n')).toContain('restart');
  });

  it('flags a live pidfile whose daemon is unreachable', async () => {
    vi.mocked(lifecycle.isDaemonRunning).mockReturnValue(true);
    vi.mocked(dc.health).mockResolvedValue(null);
    await run(['daemon', 'status']);
    expect(logs.join()).toContain('unreachable');
  });
});

describe('daemon start', () => {
  it('is idempotent when one is already running', async () => {
    vi.mocked(dc.health).mockResolvedValue(health());
    await run(['daemon', 'start']);
    expect(logs.join()).toContain('already running');
    expect(dc.spawnDaemon).not.toHaveBeenCalled();
  });

  it('spawns and confirms readiness', async () => {
    vi.mocked(dc.health)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(health({ pid: 99 }));
    vi.mocked(dc.spawnDaemon).mockResolvedValue(true);
    await run(['daemon', 'start']);
    expect(logs.join()).toContain('started');
    expect(logs.join()).toContain('99');
  });

  it('reports a failed spawn and sets a non-zero exit code', async () => {
    vi.mocked(dc.health).mockResolvedValue(null);
    vi.mocked(dc.spawnDaemon).mockResolvedValue(false);
    await run(['daemon', 'start']);
    expect(logs.join()).toContain('failed');
    expect(process.exitCode).toBe(1);
  });
});

describe('daemon stop', () => {
  it('stops a running daemon', async () => {
    vi.mocked(lifecycle.isDaemonRunning).mockReturnValue(true);
    await run(['daemon', 'stop']);
    expect(lifecycle.stopDaemon).toHaveBeenCalled();
    expect(logs.join()).toContain('stopped');
  });

  it('is a no-op when nothing is running', async () => {
    vi.mocked(lifecycle.isDaemonRunning).mockReturnValue(false);
    await run(['daemon', 'stop']);
    expect(lifecycle.stopDaemon).not.toHaveBeenCalled();
    expect(logs.join()).toContain('not running');
  });
});
