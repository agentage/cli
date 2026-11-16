import { type stopDaemon as stopDaemonType } from '../../lib/daemon/daemon-stop.js';
import { afterEach, describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { serve, type Served } from '../../test/serve.js';
import { type Probe } from '../../lib/daemon/daemon-probe.js';
import { runDaemonRestart, runDaemonStatus, runDaemonStop, settled } from './daemon.js';

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
    expect(status).toEqual({ running: true, port: served.port, ...HEALTH, move: null });
  });

  test('status: pending, unsynced and installation marks; degraded always says why', async ({
    dir,
  }) => {
    const pending = [{ op: 'install', id: 'notes', since: '2026-11-15T10:00:00Z', timedOut: true }];
    const marks = { pending, unsynced: ['probe'], installation: 'invalid' };
    const extensions = [{ id: 'notes', version: '1.0.0', state: 'failed' }];
    served = await serve(() => [200, { ...HEALTH, status: 'degraded', extensions, ...marks }]);
    dir.write('daemon.json', { pid: process.pid, port: served.port });
    let status: unknown;
    const run = await output(async () => (status = await runDaemonStatus()));
    const reasons = [
      'notes is failed',
      'a change of probe was not undone: its files disagree',
      'installation.json is invalid',
    ];
    expect(run.lines.slice(1)).toEqual([
      '  notes 1.0.0 failed',
      '  pending install notes since 2026-11-15T10:00:00Z, the daemon stopped waiting; it still runs',
      ...reasons.map((r) => `  degraded: ${r}`),
    ]);
    expect(status).toMatchObject({ status: 'degraded', ...marks, reasons });
    dir.write('installation.json.bad', {});
    expect((await output(() => runDaemonStatus())).lines).toContain(
      '  degraded: installation.json is invalid: the daemon kept the bad file as installation.json.bad'
    );
  });

  test('status: an unreadable installation.json names its reason; a bare degraded says none came', async ({
    dir,
  }) => {
    const unreadable = { installation: 'unreadable', installationError: 'EACCES' };
    const replies = [
      { ...HEALTH, status: 'degraded', ...unreadable },
      { ...HEALTH, status: 'degraded' },
    ];
    served = await serve(() => [200, replies.shift()]);
    dir.write('daemon.json', { pid: process.pid, port: served.port });
    const first = await output(() => runDaemonStatus());
    expect(first.lines).toContain('  degraded: installation.json cannot be read (EACCES)');
    const second = await output(() => runDaemonStatus());
    expect(second.lines).toContain('  degraded: the daemon gave no reason');
  });

  test('status: a live pid that does not answer is unresponsive; a stale file is not running', async ({
    dir,
  }) => {
    dir.write('daemon.json', { pid: process.pid, port: 4999 });
    const silent = async () => ({ kind: 'silent' as const });
    const run = await output(() => runDaemonStatus(silent));
    expect(run.stdout).toBe(
      `daemon: pid ${process.pid} does not answer on 127.0.0.1:4999 (3 tries, 2 s each); try again, or agentage daemon restart`
    );
    const other = async () => ({ kind: 'foreign' as const });
    expect((await output(() => runDaemonStatus(other))).stdout).toBe(
      `daemon: not running (pid ${process.pid} of daemon.json lives, but 127.0.0.1:4999 answers as another program)`
    );
    expect(dir.exists('daemon.json')).toBe(true);
  });

  test('status: a slow daemon prints one wait line on stderr past 3 s, stdout stays the answer', async ({
    dir,
  }) => {
    vi.useFakeTimers();
    try {
      dir.write('daemon.json', { pid: process.pid, port: 4999 });
      const slow = () =>
        new Promise<{ kind: 'silent' }>((done) =>
          setTimeout(() => done({ kind: 'silent' }), 6_000)
        );
      const run = output(() => runDaemonStatus(slow));
      await vi.advanceTimersByTimeAsync(6_000);
      const printed = await run;
      expect(printed.stderr).toBe(
        `waiting for the daemon (pid ${process.pid}) on 127.0.0.1:4999...`
      );
      expect(printed.lines).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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

  test('restart: stops what runs, starts one, and returns once no extension is starting', async () => {
    const ensure = vi.fn(async () => 4243);
    const settle = vi.fn(async () => []);
    expect(await runDaemonRestart(ensure, settle)).toEqual({ port: 4243, settled: true });
    expect(ensure).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(4243);
    const states = ['starting', 'running'];
    const look = vi.fn(async (): Promise<Probe> => {
      const state = states.shift() ?? 'running';
      return {
        kind: 'ours',
        health: { ...HEALTH, extensions: [{ id: 'p', version: '1', state }] },
      };
    });
    expect(await settled(4243, look, 5_000)).toEqual([]);
    expect(look).toHaveBeenCalledTimes(2);
  });

  test('restart: a settle wait that runs out is one warning naming the ids, settled false, no failure', async () => {
    const entry = (id: string, state: string) => ({ id, version: '1', state });
    const extensions = [entry('a', 'starting'), entry('b', 'running'), entry('c', 'starting')];
    const look = async (): Promise<Probe> => ({ kind: 'ours', health: { ...HEALTH, extensions } });
    expect(await settled(4243, look, 300)).toEqual(['a', 'c']);
    const run = await output(() =>
      runDaemonRestart(
        async () => 4243,
        async () => ['a', 'c']
      )
    );
    expect(run.stderr).toBe('warning: still starting after 60 s: a, c');
    expect(run.error).toBeNull();
  });
});
