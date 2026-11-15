import { createServer, type Server } from 'node:net';
import { type AddressInfo } from 'node:net';
import { describe, expect, vi } from 'vitest';
import { probe } from '../../lib/daemon/daemon-probe.js';
import { readDaemonFile } from '../../lib/daemon/daemon-file.js';
import { kitInstallsDisabled } from '../extension/kit-tool.js';
import { test } from '../../test/config-dir.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { VERSION } from '../../utils/version.js';
import { runDaemon } from './run.js';

const listening = async (): Promise<Server> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

// C4 as the sheet types it: no token file.
const C4 = { version: VERSION, protocol: 1, startedBy: 'cli' };

const portOf = (server: Server): number => (server.address() as AddressInfo).port;

const noInstaller = () => async () => {
  throw new Error('no installs here');
};

describe('daemon run: the daemon process', () => {
  test('runs the kit daemon until SIGTERM, then removes daemon.json', async ({ dir }) => {
    const free = await listening();
    const port = portOf(free);
    await new Promise((resolve) => free.close(resolve));
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const before = vi.fn(async () => undefined);
    const running = runDaemon({ installer: noInstaller, before });
    // daemon.json is written after the port opens: wait for the file, not the port.
    await vi.waitFor(() => expect(readDaemonFile()).toEqual({ ...C4, pid: process.pid, port }), {
      timeout: 10_000,
    });
    expect((await probe(port)).kind).not.toBe('none');
    expect(before).toHaveBeenCalledOnce();
    process.emit('SIGTERM');
    await running;
    expect(dir.exists('daemon.json')).toBe(false);
    vi.unstubAllEnvs();
  });

  test('a stop that comes during the boot still stops the daemon and removes daemon.json', async ({
    dir,
  }) => {
    const free = await listening();
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(portOf(free)));
    await new Promise((resolve) => free.close(resolve));
    const before = vi.fn(async () => void process.emit('SIGTERM'));
    await runDaemon({ installer: noInstaller, before });
    expect(dir.exists('daemon.json')).toBe(false);
    vi.unstubAllEnvs();
  });

  test('a busy port exits 3 so the spawning cli stops waiting', async () => {
    const busy = await listening();
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(portOf(busy)));
    await expect(runDaemon({ installer: noInstaller })).rejects.toMatchObject({ exitCode: 3 });
    await new Promise((resolve) => busy.close(resolve));
    vi.unstubAllEnvs();
  });

  // setup sends enabled: false on the add only when the kit lists installDisabled; else it disables after.
  test('the real kit daemon refuses enabled: false on an add until the kit lists installDisabled', async ({
    dir,
  }) => {
    const free = await listening();
    const port = portOf(free);
    await new Promise((resolve) => free.close(resolve));
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const running = runDaemon({ installer: noInstaller });
    try {
      await vi.waitFor(() => expect(readDaemonFile()?.port).toBe(port), { timeout: 10_000 });
      const source = writeKitExtension(dir.at('demo'), 'demo', '0.1.0');
      const res = await fetch(`http://127.0.0.1:${port}/host/extensions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, enabled: false }),
      });
      const listed = await kitInstallsDisabled();
      expect({ status: res.status, listed }, 'the kit takes it: list installDisabled').toEqual({
        status: 400,
        listed: false,
      });
      expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    } finally {
      process.emit('SIGTERM');
      await running;
      vi.unstubAllEnvs();
    }
  });
});
