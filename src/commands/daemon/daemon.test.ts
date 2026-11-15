import { spawn } from 'node:child_process';
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
    expect(status).toEqual({ running: true, pid: process.pid, port: served.port, ...HEALTH });
  });

  // Spawns one node process; a sandbox that kills children fails this test, it is not skipped.
  test('stop: a running daemon stops; with none it says so, exit 0', async ({ dir }) => {
    expect(await runDaemonStop()).toEqual({ stopped: false });
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    dir.write('daemon.json', { pid: child.pid, port: 4243 });
    const run = await output(async () => expect(await runDaemonStop()).toEqual({ stopped: true }));
    expect(run.stdout).toBe(`daemon: stopped (pid ${child.pid})`);
  });

  test('restart: stops what runs, then starts one', async () => {
    const ensure = vi.fn(async () => 4243);
    expect(await runDaemonRestart(ensure)).toEqual({ port: 4243 });
    expect(ensure).toHaveBeenCalledOnce();
  });
});
