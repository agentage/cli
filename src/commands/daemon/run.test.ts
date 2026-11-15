import { createServer, type Server } from 'node:net';
import { type AddressInfo } from 'node:net';
import { describe, expect, vi } from 'vitest';
import { probe } from '../../lib/daemon/daemon-probe.js';
import { readDaemonFile } from '../../lib/daemon/daemon-file.js';
import { test } from '../../test/config-dir.js';
import { runDaemon } from './run.js';

const listening = async (): Promise<Server> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

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
    await vi.waitFor(async () => expect((await probe(port)).kind).not.toBe('none'), {
      timeout: 10_000,
    });
    expect(readDaemonFile()).toMatchObject({ pid: process.pid, port, startedBy: 'cli' });
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
});
