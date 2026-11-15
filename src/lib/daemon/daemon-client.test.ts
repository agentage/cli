import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { serve, type Served } from '../../test/serve.js';
import {
  ensureDaemon,
  health,
  spawnDaemon,
  waitForHealth,
  type EnsureDeps,
} from './daemon-client.js';

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const HEALTH = { status: 'ok', version: '0.52.0', extensions: [] };

const deps = (over: Partial<EnsureDeps> = {}): EnsureDeps => ({
  health: vi.fn(async () => null),
  spawn: vi.fn(async () => 'ok' as const),
  log: vi.fn(),
  ...over,
});

describe('the daemon start', () => {
  test('health reads /health; anything else is null', async () => {
    served = await serve((req) => (req.url === '/health' ? [200, HEALTH] : [404, {}]));
    expect(await health(served.port)).toEqual(HEALTH);
    expect(await waitForHealth(served.port, 1000)).toBe(true);
    const { port } = served;
    await served.close();
    served = undefined;
    expect(await health(port)).toBeNull();
    expect(await waitForHealth(port, 150)).toBe(false);
  });

  test('a live daemon from daemon.json is used; nothing spawns', async ({ dir }) => {
    dir.write('daemon.json', { pid: process.pid, port: 4999 });
    const d = deps({ health: vi.fn(async () => HEALTH) });
    expect(await ensureDaemon(d)).toBe(4999);
    expect(d.spawn).not.toHaveBeenCalled();
  });

  test('a stale daemon.json is removed and a daemon spawns on the port', async ({ dir }) => {
    vi.stubEnv('AGENTAGE_DAEMON_PORT', '4555');
    dir.write('daemon.json', { pid: 2 ** 22 + 7, port: 4555 });
    const d = deps();
    expect(await ensureDaemon(d)).toBe(4555);
    expect(dir.exists('daemon.json')).toBe(false);
    expect(d.spawn).toHaveBeenCalledWith(4555);
    expect(d.log).toHaveBeenCalledWith('daemon started on 127.0.0.1:4555');
    vi.unstubAllEnvs();
  });

  test('a busy port that serves a daemon is fine; one that does not, or silence, fails', async () => {
    const busy = deps({ spawn: vi.fn(async () => 'port-in-use' as const) });
    busy.health = vi.fn(async () => HEALTH);
    expect(await ensureDaemon(busy)).toBe(4243);
    const taken = deps({ spawn: vi.fn(async () => 'port-in-use' as const) });
    await expect(ensureDaemon(taken)).rejects.toMatchObject({
      code: 'daemon_unavailable',
      message: 'the daemon did not start: port 4243 is in use',
    });
    const silent = deps({ spawn: vi.fn(async () => 'unreachable' as const) });
    await expect(ensureDaemon(silent)).rejects.toThrow('it did not answer');
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
