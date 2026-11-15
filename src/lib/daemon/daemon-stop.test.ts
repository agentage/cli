import { spawn } from 'node:child_process';
import { describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { isAlive } from './daemon-file.js';
import { type Probe } from './daemon-probe.js';
import { stopDaemon } from './daemon-stop.js';

const ours = (pid: number): Probe => ({
  kind: 'ours',
  health: {
    status: 'ok',
    service: 'agentage-daemon',
    pid,
    version: '0',
    protocol: 1,
    extensions: [],
  },
});
const deps = (found: Probe, timeoutMs = 30_000) => ({ probe: vi.fn(async () => found), timeoutMs });

// Spawns one node process; a sandbox that kills children fails these tests, they are not skipped.
const child = (code = 'setInterval(() => {}, 1000)') =>
  spawn(process.execPath, ['-e', code], { stdio: 'ignore' });

describe('daemon stop', () => {
  test('no daemon.json: nothing to stop; a dead pid: the stale file goes', async ({ dir }) => {
    expect(await stopDaemon(deps({ kind: 'none' }))).toBeNull();
    dir.write('daemon.json', { pid: 2 ** 22 + 7, port: 4243 });
    expect(await stopDaemon(deps({ kind: 'none' }))).toEqual({ stale: 2 ** 22 + 7 });
    expect(dir.exists('daemon.json')).toBe(false);
  });

  test('a live pid that is not the daemon is never signalled; only the file goes', async ({
    dir,
  }) => {
    const other = child();
    dir.write('daemon.json', { pid: other.pid, port: 4243 });
    for (const found of [{ kind: 'foreign' }, { kind: 'none' }, ours(1)] as Probe[]) {
      dir.write('daemon.json', { pid: other.pid, port: 4243 });
      expect(await stopDaemon(deps(found))).toEqual({ stale: other.pid });
      expect(dir.exists('daemon.json')).toBe(false);
    }
    expect(isAlive(other.pid ?? 0)).toBe(true);
    other.kill();
  });

  test('a silent port with a live pid keeps the file and signals nothing', async ({ dir }) => {
    const other = child();
    dir.write('daemon.json', { pid: other.pid, port: 4243 });
    await expect(stopDaemon(deps({ kind: 'silent' }))).rejects.toMatchObject({
      code: 'daemon_unresponsive',
    });
    expect(dir.exists('daemon.json')).toBe(true);
    expect(isAlive(other.pid ?? 0)).toBe(true);
    other.kill();
  });

  test('the proven daemon gets SIGTERM; stop returns once the pid is gone', async ({ dir }) => {
    const pid = child().pid ?? 0;
    dir.write('daemon.json', { pid, port: 4243 });
    expect(await stopDaemon(deps(ours(pid)))).toEqual({ stopped: pid });
    expect(isAlive(pid)).toBe(false);
    expect(dir.exists('daemon.json')).toBe(false);
  });

  test('a proven daemon that ignores SIGTERM is killed after the wait', async ({ dir }) => {
    const deaf = child("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pid = deaf.pid ?? 0;
    dir.write('daemon.json', { pid, port: 4243 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const slow = { ...deps(ours(pid), 400), progressMs: 100 };
    expect(await stopDaemon(slow)).toEqual({ stopped: pid });
    expect(isAlive(pid)).toBe(false);
    expect(errors.mock.calls).toEqual([[`waiting for the daemon (pid ${pid}) to stop...`]]);
    errors.mockRestore();
  });

  test('a pid that outlives SIGKILL is stop_failed with the pid, and daemon.json stays', async ({
    dir,
  }) => {
    const pid = 2 ** 22 + 9;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    dir.write('daemon.json', { pid, port: 4243 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stuck = { ...deps(ours(pid), 50), killMs: 50 };
    await expect(stopDaemon(stuck)).rejects.toMatchObject({
      code: 'stop_failed',
      message: `the daemon (pid ${pid}) did not stop, not even on SIGKILL`,
    });
    expect(kill.mock.calls.map((call) => call[1])).toContain('SIGKILL');
    expect(dir.exists('daemon.json')).toBe(true);
    kill.mockRestore();
    errors.mockRestore();
  });
});
