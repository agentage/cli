import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import { type AddressInfo } from 'node:net';
import { describe, expect, vi } from 'vitest';
import { probe } from '../../lib/daemon/daemon-probe.js';
import { readDaemonFile } from '../../lib/daemon/daemon-file.js';
import { CliError, type DaemonError } from '../../lib/json-output.js';
import { hostClient } from '../../lib/daemon/host-client.js';
import { test } from '../../test/config-dir.js';
import { freePort } from '../../test/serve.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { VERSION } from '../../utils/version.js';
import { clockRateOf, runDaemon } from './run.js';

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
    const port = await freePort();
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const before = vi.fn(async () => undefined);
    const running = runDaemon({ installer: noInstaller, before });
    // daemon.json is written after the port opens: wait for the file, not the port.
    await vi.waitFor(
      () =>
        expect(readDaemonFile()).toEqual({
          ...C4,
          pid: process.pid,
          port,
          hostToken: expect.any(String),
        }),
      {
        timeout: 10_000,
      }
    );
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

  const serving = async (port: number) => {
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const running = runDaemon({ installer: noInstaller });
    await vi.waitFor(() => expect(readDaemonFile()?.port).toBe(port), { timeout: 10_000 });
    return async () => {
      process.emit('SIGTERM');
      await running;
      vi.unstubAllEnvs();
    };
  };

  // setup sends enabled: false on the add: the bundled kit lists installDisabled.
  test('the real kit daemon installs an entry disabled; a second add is 409 with the entry', async ({
    dir,
  }) => {
    const port = await freePort();
    const stop = await serving(port);
    try {
      const source = writeKitExtension(dir.at('demo'), 'demo', '0.1.0');
      const res = await fetch(`http://127.0.0.1:${port}/host/extensions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${readDaemonFile()?.hostToken ?? ''}`,
        },
        body: JSON.stringify({ source, enabled: false }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ data: { id: 'demo', state: 'disabled' } });
      // The second add is a 409 whose details name the entry: what installFolder reads.
      const again = await hostClient(port)
        .add({ source })
        .catch((e: unknown) => e);
      expect(again).toMatchObject({ code: 'CONFLICT', status: 409 });
      expect((again as DaemonError).details).toEqual({ id: 'demo', version: '0.1.0', source });
    } finally {
      await stop();
    }
  });

  // The kit lets its own process through, so the first daemon is another live process.
  test('a second daemon run on the same config folder ends with already_running, no stack', async ({
    dir,
  }) => {
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = other.pid ?? 0;
    const health = createHttpServer((_req, res) =>
      res.end(JSON.stringify({ service: 'agentage-daemon', pid }))
    );
    await new Promise<void>((resolve) => health.listen(0, '127.0.0.1', resolve));
    const port = (health.address() as AddressInfo).port;
    dir.write('daemon.json', { ...C4, pid, port });
    try {
      vi.stubEnv('AGENTAGE_DAEMON_PORT', String(await freePort()));
      const err = await runDaemon({ installer: noInstaller }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('already_running');
      expect((err as Error).message).toMatch(`a daemon (pid ${pid} on 127.0.0.1:${port}) runs on `);
      expect(dir.json('daemon.json')['pid'], 'the first daemon keeps its file').toBe(pid);
    } finally {
      other.kill('SIGKILL');
      await new Promise((resolve) => health.close(resolve));
      vi.unstubAllEnvs();
    }
  });
});

describe('the test clock (C5)', () => {
  test('only AGENTAGE_DAEMON_CLOCK_RATE sets clockRate; unset or empty is the real clock', () => {
    expect(clockRateOf({ AGENTAGE_DAEMON_CLOCK_RATE: '60' })).toEqual({ clockRate: 60 });
    expect(clockRateOf({ AGENTAGE_DAEMON_CLOCK_RATE: '' })).toEqual({});
    expect(clockRateOf({ AGENTAGE_CLOCK_RATE: '60' })).toEqual({});
  });
});
