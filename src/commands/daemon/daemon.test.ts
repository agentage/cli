import { type stopDaemon as stopDaemonType } from '../../lib/daemon/daemon-stop.js';
import { afterEach, describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { serve, type Served } from '../../test/serve.js';
import { runDaemonRestart, runDaemonStatus, runDaemonStop } from './daemon.js';

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const HEALTH = {
  status: 'ok',
  service: 'agentage-daemon',
  pid: process.pid,
  protocol: 1,
  version: '0.52.0',
  extensions: [{ id: 'probe', version: '0.7.0', state: 'running' }],
};

describe('agentage daemon status | stop | restart', () => {
  test('status: not running, then running with its extensions', async ({ dir }) => {
    expect((await output(runDaemonStatus)).stdout).toBe('daemon: not running');
    served = await serve(() => [200, HEALTH]);
    dir.write('daemon.json', { pid: process.pid, port: served.port });
    let status: unknown;
    const run = await output(async () => (status = await runDaemonStatus()));
    expect(run.stdout).toBe(
      `daemon: ok on 127.0.0.1:${served.port}, pid ${process.pid}, 0.52.0\n  probe 0.7.0 running`
    );
    expect(status).toEqual({ running: true, port: served.port, ...HEALTH });
  });

  test('status: a live pid that does not answer is unresponsive; a stale file is not running', async ({
    dir,
  }) => {
    dir.write('daemon.json', { pid: process.pid, port: 4999 });
    const silent = async () => ({ kind: 'silent' as const });
    const run = await output(() => runDaemonStatus(silent));
    expect(run.stdout).toBe(`daemon: pid ${process.pid} does not answer on 127.0.0.1:4999`);
    const other = async () => ({ kind: 'foreign' as const });
    expect((await output(() => runDaemonStatus(other))).stdout).toBe('daemon: not running');
    expect(dir.exists('daemon.json')).toBe(true);
  });

  test('stop: the stopped pid, a stale file, or none', async () => {
    const stop = (result: Awaited<ReturnType<typeof stopDaemonType>>) => async () => result;
    const stopped = await output(async () =>
      expect(await runDaemonStop(stop({ stopped: 12 }))).toEqual({ stopped: true })
    );
    expect(stopped.stdout).toBe('daemon: stopped (pid 12)');
    const stale = await output(() => runDaemonStop(stop({ stale: 12 })));
    expect(stale.stdout).toBe('daemon: not running (daemon.json was stale; pid 12 not signalled)');
    expect((await output(() => runDaemonStop(stop(null)))).stdout).toBe('daemon: not running');
  });

  test('restart: stops what runs, then starts one', async () => {
    const ensure = vi.fn(async () => 4243);
    expect(await runDaemonRestart(ensure)).toEqual({ port: 4243 });
    expect(ensure).toHaveBeenCalledOnce();
  });
});
