import { spawn } from 'node:child_process';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { isAlive } from './daemon-file.js';
import { stopDaemon } from './daemon-stop.js';

describe('daemon stop', () => {
  test('no daemon.json, or a dead pid: nothing to stop, a stale file is removed', async ({
    dir,
  }) => {
    expect(await stopDaemon()).toBeNull();
    dir.write('daemon.json', { pid: 2 ** 22 + 7, port: 4243 });
    expect(await stopDaemon()).toBeNull();
    expect(dir.exists('daemon.json')).toBe(false);
  });

  // Spawns one node process; a sandbox that kills children fails this test, it is not skipped.
  test('a live daemon gets SIGTERM; stop returns once the pid is gone', async ({ dir }) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid ?? 0;
    dir.write('daemon.json', { pid, port: 4243 });
    expect(await stopDaemon()).toBe(pid);
    expect(isAlive(pid)).toBe(false);
    expect(dir.exists('daemon.json')).toBe(false);
  });

  test('a daemon that ignores SIGTERM is killed after the wait', async ({ dir }) => {
    const code = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
    const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    dir.write('daemon.json', { pid: child.pid, port: 4243 });
    expect(await stopDaemon(200)).toBe(child.pid);
    expect(isAlive(child.pid ?? 0)).toBe(false);
  });
});
