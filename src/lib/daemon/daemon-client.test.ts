import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { VERSION } from '../../utils/version.js';
import {
  daemonLogPath,
  ensureDaemon,
  openDaemonLog,
  restartIfRunning,
  spawnDaemon,
  type EnsureDeps,
} from './daemon-client.js';
import { type Probe } from './daemon-probe.js';

afterEach(() => vi.unstubAllEnvs());

const ours = (pid = process.pid, version = VERSION, protocol = 1): Probe => ({
  kind: 'ours',
  health: { status: 'ok', service: 'agentage-daemon', pid, version, protocol, extensions: [] },
});

const deps = (over: Partial<EnsureDeps> = {}): EnsureDeps => ({
  probe: vi.fn(async (): Promise<Probe> => ({ kind: 'none' })),
  spawn: vi.fn(async () => 'ok' as const),
  stop: vi.fn(async () => ({ stopped: process.pid })),
  log: vi.fn(),
  ...over,
});

describe('the daemon start', () => {
  test('the proven daemon of daemon.json is used; nothing spawns', async ({ dir }) => {
    dir.write('daemon.json', { pid: process.pid, port: 4999 });
    const d = deps({ probe: vi.fn(async () => ours()) });
    expect(await ensureDaemon(d)).toBe(4999);
    expect(d.spawn).not.toHaveBeenCalled();
    expect(d.probe).toHaveBeenCalledWith(4999);
  });

  test('a dead pid, or a live pid whose port is not that daemon: the file goes, one spawns', async ({
    dir,
  }) => {
    vi.stubEnv('AGENTAGE_DAEMON_PORT', '4555');
    for (const [pid, found] of [
      [2 ** 22 + 7, ours()],
      [process.pid, ours(1)],
      [process.pid, { kind: 'foreign' }],
    ] as const) {
      dir.write('daemon.json', { pid, port: 4556 });
      const d = deps({ probe: vi.fn(async () => found as Probe) });
      expect(await ensureDaemon(d)).toBe(4555);
      expect(dir.exists('daemon.json')).toBe(false);
      expect(d.spawn).toHaveBeenCalledWith(4555);
      expect(d.log).toHaveBeenCalledWith('daemon started on 127.0.0.1:4555');
    }
  });

  test('a live pid that does not answer keeps daemon.json and fails unresponsive', async ({
    dir,
  }) => {
    dir.write('daemon.json', { pid: process.pid, port: 4999 });
    const d = deps({ probe: vi.fn(async (): Promise<Probe> => ({ kind: 'silent' })) });
    await expect(ensureDaemon(d)).rejects.toMatchObject({ code: 'daemon_unresponsive' });
    expect(dir.exists('daemon.json')).toBe(true);
    expect(d.spawn).not.toHaveBeenCalled();
  });

  test('another version or protocol: stop, start, one line on stderr', async ({ dir }) => {
    for (const found of [ours(process.pid, '0.0.1'), ours(process.pid, VERSION, 2)]) {
      dir.write('daemon.json', { pid: process.pid, port: 4243 });
      const d = deps({ probe: vi.fn(async () => found) });
      expect(await ensureDaemon(d)).toBe(4243);
      expect(d.stop).toHaveBeenCalledOnce();
      expect(d.spawn).toHaveBeenCalledWith(4243);
      expect(d.log).toHaveBeenCalledOnce();
      expect(vi.mocked(d.log).mock.calls[0]?.[0]).toMatch(/^daemon restarted: it ran /);
    }
  });

  test('a busy port: our daemon serves; another program is port_in_use naming the variable', async () => {
    const spawnBusy = vi.fn(async () => 'port-in-use' as const);
    expect(await ensureDaemon(deps({ spawn: spawnBusy, probe: vi.fn(async () => ours()) }))).toBe(
      4243
    );
    const taken = deps({
      spawn: spawnBusy,
      probe: vi.fn(async (): Promise<Probe> => ({ kind: 'foreign' })),
    });
    await expect(ensureDaemon(taken)).rejects.toMatchObject({
      code: 'port_in_use',
      message: expect.stringMatching(/port 4243 .*AGENTAGE_DAEMON_PORT/),
    });
    const silent = deps({ spawn: vi.fn(async () => 'unreachable' as const) });
    await expect(ensureDaemon(silent)).rejects.toThrow('it did not answer');
  });

  test('AGENTAGE_NO_DAEMON=1: daemon_disabled, nothing probed or spawned', async () => {
    vi.stubEnv('AGENTAGE_NO_DAEMON', '1');
    const d = deps();
    await expect(ensureDaemon(d)).rejects.toMatchObject({ code: 'daemon_disabled' });
    expect(d.spawn).not.toHaveBeenCalled();
  });

  test('after an update: a running daemon restarts; none, or a stale file, starts nothing', async () => {
    const d = deps();
    expect(await restartIfRunning(d)).toBe(true);
    expect(d.spawn).toHaveBeenCalledOnce();
    for (const result of [null, { stale: 12 }]) {
      const none = deps({ stop: vi.fn(async () => result) });
      expect(await restartIfRunning(none)).toBe(false);
      expect(none.spawn).not.toHaveBeenCalled();
    }
  });

  test('daemon.log over the cap moves to daemon.log.1 at the next start', async ({ dir }) => {
    dir.write('logs/daemon.log', 'x'.repeat(2048));
    openDaemonLog(1024);
    expect(dir.file('logs/daemon.log.1')).toHaveLength(2048);
    expect(dir.file('logs/daemon.log')).toBe('');
    writeFileSync(daemonLogPath(), 'small');
    openDaemonLog(1024);
    expect(dir.file('logs/daemon.log')).toBe('small');
  });

  // Spawns one node process; a sandbox that kills children fails this test, it is not skipped.
  test('spawn: a daemon that exits with the busy code is port-in-use', async ({ dir }) => {
    const entry = join(mkdtempSync(join(tmpdir(), 'agentage-entry-')), 'busy.mjs');
    writeFileSync(entry, 'process.exit(3);\n');
    expect(await spawnDaemon(1, entry)).toBe('port-in-use');
    writeFileSync(entry, 'process.exit(1);\n');
    expect(await spawnDaemon(1, entry)).toBe('unreachable');
    expect(dir.exists('logs/daemon.log')).toBe(true);
  });
});
