import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { VERSION } from '../../utils/version.js';
import {
  daemonLogPath,
  defaultEnsureDeps,
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

  test('a dead pid: the file goes, one spawns', async ({ dir }) => {
    vi.stubEnv('AGENTAGE_DAEMON_PORT', '4555');
    for (const found of [ours(), { kind: 'foreign' }, { kind: 'none' }] as Probe[]) {
      dir.write('daemon.json', { pid: 2 ** 22 + 7, port: 4556 });
      const d = deps({ probe: vi.fn(async () => found) });
      expect(await ensureDaemon(d)).toBe(4555);
      expect(dir.exists('daemon.json')).toBe(false);
      expect(d.spawn).toHaveBeenCalledWith(4555);
      expect(d.log).toHaveBeenCalledWith('daemon started on 127.0.0.1:4555');
    }
  });

  test('the started line goes to stderr: a command that fails after it is not a half success on stdout', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultEnsureDeps.log('daemon started on 127.0.0.1:4555');
    expect(error).toHaveBeenCalledWith('daemon started on 127.0.0.1:4555');
    expect(log).not.toHaveBeenCalled();
  });

  test('a live pid whose port refuses: a reused pid, the file goes, nothing signalled, one spawns', async ({
    dir,
  }) => {
    vi.stubEnv('AGENTAGE_DAEMON_PORT', '4555');
    dir.write('daemon.json', { pid: process.pid, port: 4556 });
    const d = deps({ probe: vi.fn(async (): Promise<Probe> => ({ kind: 'none' })) });
    expect(await ensureDaemon(d)).toBe(4555);
    expect(dir.exists('daemon.json')).toBe(false);
    expect(d.stop).not.toHaveBeenCalled();
    expect(d.spawn).toHaveBeenCalledWith(4555);
  });

  test('a live pid whose port answers, but not as that daemon: port_in_use, nothing starts', async ({
    dir,
  }) => {
    for (const found of [ours(1), { kind: 'foreign' }] as Probe[]) {
      dir.write('daemon.json', { pid: process.pid, port: 4556 });
      const d = deps({ probe: vi.fn(async () => found) });
      await expect(ensureDaemon(d)).rejects.toMatchObject({
        code: 'port_in_use',
        message: expect.stringContaining('4556'),
      });
      expect(dir.exists('daemon.json')).toBe(true);
      expect(d.spawn).not.toHaveBeenCalled();
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

  test('a same or newer daemon serves as it is; never a downgrade restart', async ({ dir }) => {
    const [major, minor] = VERSION.split('.').map(Number);
    for (const version of [VERSION, `${major}.${(minor ?? 0) + 1}.0`, `${(major ?? 0) + 1}.0.0`]) {
      dir.write('daemon.json', { pid: process.pid, port: 4243 });
      const d = deps({ probe: vi.fn(async () => ours(process.pid, version)) });
      expect(await ensureDaemon(d)).toBe(4243);
      expect(d.stop).not.toHaveBeenCalled();
      expect(d.spawn).not.toHaveBeenCalled();
    }
  });

  test('an older version or another protocol: stop, start, one line on stderr', async ({ dir }) => {
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

  test('a busy port: the daemon this folder started at the same time serves; another program is port_in_use naming the variable', async ({
    dir,
  }) => {
    const spawnBusy = vi.fn(async () => {
      dir.write('daemon.json', { pid: process.pid, port: 4243 });
      return 'port-in-use' as const;
    });
    const d = deps({ spawn: spawnBusy, probe: vi.fn(async () => ours()) });
    expect(await ensureDaemon(d)).toBe(4243);
    expect(d.log).not.toHaveBeenCalled();
    const taken = deps({
      spawn: spawnBusy,
      probe: vi.fn(async (): Promise<Probe> => ({ kind: 'foreign' })),
    });
    await expect(ensureDaemon(taken)).rejects.toMatchObject({
      code: 'port_in_use',
      message: expect.stringMatching(/port 4243 .*AGENTAGE_DAEMON_PORT/),
    });
    const silent = deps({ spawn: vi.fn(async () => 'unreachable' as const) });
    await expect(ensureDaemon(silent)).rejects.toThrow(
      /it did not answer; see agentage daemon status and .*daemon\.log/
    );
  });

  test('a busy port held by the daemon of another config folder: refused, never used, never "started"', async ({
    dir,
  }) => {
    const other = deps({
      spawn: vi.fn(async () => 'port-in-use' as const),
      probe: vi.fn(async () => ours(4321)),
    });
    await expect(ensureDaemon(other)).rejects.toMatchObject({
      code: 'port_in_use',
      message: expect.stringMatching(
        /port 4243 .*daemon \(pid 4321\) of another config folder.*kill 4321/
      ),
    });
    expect(other.log).not.toHaveBeenCalled();
    expect(dir.exists('daemon.json')).toBe(false);
  });

  test('a start that timed out uses a proven daemon that came up late', async ({ dir }) => {
    const late = deps({
      spawn: vi.fn(async () => {
        dir.write('daemon.json', { pid: process.pid, port: 4243 });
        return 'unreachable' as const;
      }),
      probe: vi.fn(async () => ours()),
    });
    expect(await ensureDaemon(late)).toBe(4243);
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

  // Shape of e2e run 43775263990: another folder's daemon answers on the port while ours exits busy.
  test('spawn: the daemon of another config folder answering on the port is not a start', async () => {
    const health = { status: 'ok', service: 'agentage-daemon', pid: 4321, version: VERSION };
    const body = JSON.stringify({ ...health, protocol: 1, extensions: [] });
    const server = createServer((_req, res) => res.end(body)).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const entry = join(mkdtempSync(join(tmpdir(), 'agentage-entry-')), 'busy.mjs');
    writeFileSync(entry, 'setTimeout(() => process.exit(3), 1500);\n');
    try {
      expect(await spawnDaemon((server.address() as AddressInfo).port, entry)).toBe('port-in-use');
    } finally {
      server.close();
    }
  });
});
