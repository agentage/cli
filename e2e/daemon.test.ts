import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, freePort, type CliMachine } from './helpers.js';

// M2.5 daemon tier: an explicitly managed daemon on an ephemeral port + isolated config dir owns
// the engine; the memory verbs route through it (proven by its served counter). Never touches a
// real daemon: the OS-picked port + AGENTAGE_CONFIG_DIR isolate everything, and stop only
// signals the pid this test started. @p0

const pidOf = (m: CliMachine): number | null => {
  const p = join(m.configDir, 'daemon.pid');
  return existsSync(p) ? Number.parseInt(readFileSync(p, 'utf-8').trim(), 10) : null;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const servedCount = (statusOut: string): number => {
  const m = statusOut.match(/served\s+(\d+)/);
  return m ? Number.parseInt(m[1], 10) : -1;
};

test.describe('daemon owns the engine @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('start -> six verbs through the daemon -> stop', async () => {
    const port = await freePort();
    // Re-enable the daemon path (helpers default it off) on the isolated port.
    const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
    let daemonPid: number | null = null;
    try {
      const add = await m.exec(['vault', 'add', 'main', '--local', join(m.configDir, 'main')]);
      expect(add.code, add.stderr).toBe(0);

      const start = await m.exec(['daemon', 'start']);
      expect(start.code, start.stderr).toBe(0);
      expect(start.stdout).toContain('started');
      daemonPid = pidOf(m);
      expect(daemonPid, 'daemon.pid written').not.toBeNull();
      expect(alive(daemonPid!)).toBe(true);

      const before = await m.exec(['daemon', 'status']);
      expect(before.code, before.stderr).toBe(0);
      expect(before.stdout).toContain(`port     ${port}`);
      const served0 = servedCount(before.stdout);
      expect(served0).toBeGreaterThanOrEqual(0);

      const write = await m.exec(['memory', 'write', 'notes/d.md', '--body', 'daemon quokka']);
      expect(write.code, write.stderr).toBe(0);

      const search = await m.exec(['memory', 'search', 'quokka', '--json']);
      expect(search.code, search.stderr).toBe(0);
      expect(JSON.parse(search.stdout).results.map((r: { path: string }) => r.path)).toEqual([
        'notes/d.md',
      ]);

      const read = await m.exec(['memory', 'read', 'notes/d.md']);
      expect(read.code, read.stderr).toBe(0);
      expect(read.stdout).toContain('daemon quokka');

      const edit = await m.exec([
        'memory',
        'edit',
        'notes/d.md',
        '--old',
        'quokka',
        '--new',
        'wombat',
      ]);
      expect(edit.code, edit.stderr).toBe(0);

      const list = await m.exec(['memory', 'list', '--json']);
      expect(list.code, list.stderr).toBe(0);

      const del = await m.exec(['memory', 'delete', 'notes/d.md']);
      expect(del.code, del.stderr).toBe(0);

      // The daemon-side marker: its request counter advanced by the six verbs.
      const after = await m.exec(['daemon', 'status']);
      expect(after.code, after.stderr).toBe(0);
      expect(servedCount(after.stdout)).toBeGreaterThanOrEqual(served0 + 6);
      expect(after.stdout).toContain(`pid      ${daemonPid}`);

      const stop = await m.exec(['daemon', 'stop']);
      expect(stop.code, stop.stderr).toBe(0);
      expect(stop.stdout).toContain('stopped');
      expect(existsSync(join(m.configDir, 'daemon.pid'))).toBe(false);
      expect(existsSync(join(m.configDir, 'daemon.port'))).toBe(false);

      // SIGTERM is asynchronous - poll until the process exits and the port frees.
      const deadline = Date.now() + 5_000;
      while (alive(daemonPid!) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(alive(daemonPid!), 'daemon process terminated').toBe(false);

      const status = await m.exec(['daemon', 'status']);
      expect(status.stdout).toContain('not running');
    } finally {
      // Kill only the pid this test started, never a real daemon.
      if (daemonPid !== null && alive(daemonPid)) process.kill(daemonPid, 'SIGKILL');
      m.cleanup();
    }
  });

  test('--no-daemon runs the verbs without spawning a daemon', async () => {
    const port = await freePort();
    const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
    try {
      await m.exec(['vault', 'add', 'main', '--local', join(m.configDir, 'main')]);
      const write = await m.exec(['--no-daemon', 'memory', 'write', 'a.md', '--body', 'direct']);
      expect(write.code, write.stderr).toBe(0);
      expect(existsSync(join(m.configDir, 'daemon.pid')), 'no daemon spawned').toBe(false);
      const read = await m.exec(['--no-daemon', 'memory', 'read', 'a.md']);
      expect(read.stdout).toContain('direct');
    } finally {
      m.cleanup();
    }
  });
});
