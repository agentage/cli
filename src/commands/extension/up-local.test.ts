import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { markOf } from '../../lib/proc/start-time.js';
import { output, test } from '../../test/config-dir.js';
import { ENDED, rec } from '../../test/up-record.js';
import { acquireFileLock, releaseFileLock } from '../../lib/fs/file-lock.js';
import {
  claimFolder,
  readRecord,
  recordPath,
  refuseRunning,
  removeRecord,
  rewriteRecord,
  stopLocal,
  untilStopped,
  writeRecord,
} from './up-local.js';

describe('the up record of a folder', () => {
  test('a live up of the folder is refused; one that ended keeps only its added', ({ dir }) => {
    writeRecord(dir.at('w'), rec(process.ppid, true));
    expect(() => refuseRunning(dir.at('w'))).toThrow(
      /extension up runs for .* agentage extension down/
    );
    writeRecord(dir.at('w'), rec(ENDED, true));
    expect(refuseRunning(dir.at('w'))).toMatchObject({ added: true });
    // A reused pid: alive, but it started at another time; it is not that up.
    writeRecord(dir.at('w'), rec(process.ppid, true, 'another start'));
    expect(refuseRunning(dir.at('w'))).toMatchObject({ added: true });
  });

  test('down removes the record and waits for that up to exit; one that does not is stop_failed', async ({
    dir,
  }) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
    writeRecord(dir.at('w'), rec(child.pid ?? 0, false));
    expect((await stopLocal(dir.at('w'))).down).toBe('stopped');
    expect(dir.exists('w/.agentage/up.json')).toBe(false);
    expect((await stopLocal(dir.at('w'))).down).toBe('none');
    writeRecord(dir.at('w'), rec(process.ppid, false));
    await expect(stopLocal(dir.at('w'), 200)).rejects.toThrow(/did not stop/);
    writeRecord(dir.at('w'), rec(process.ppid, false, 'another start'));
    expect((await stopLocal(dir.at('w'))).down).toBe('stale');
  });

  test('an up.json of another shape or not JSON reads as no record', ({ dir }) => {
    dir.write('w/.agentage/up.json', { pid: process.pid, id: 'demo', added: true });
    expect(readRecord(dir.at('w'))).toBeNull();
    writeFileSync(recordPath(dir.at('w')), 'not json');
    expect(readRecord(dir.at('w'))).toBeNull();
  });
});

describe('how an up ends', () => {
  test('up ends when down removes its record, another up rewrites it, a SIGTERM, or its watch dies', async ({
    dir,
  }) => {
    const never = new Promise<string>(() => undefined);
    writeRecord(dir.at('w'), rec(process.pid, true));
    const ended = untilStopped(dir.at('w'), 'n1', never, 50);
    removeRecord(dir.at('w'));
    expect(await ended).toBe('down');
    writeRecord(dir.at('w'), rec(process.pid, true));
    const rewritten = untilStopped(dir.at('w'), 'n1', never, 50);
    writeRecord(dir.at('w'), { ...rec(process.pid, true), nonce: 'n2' });
    expect(await rewritten).toBe('down');
    const signalled = untilStopped(dir.at('w'), 'n2', never, 50);
    process.emit('SIGTERM');
    expect(await signalled).toBe('SIGTERM');
    const hungUp = untilStopped(dir.at('w'), 'n2', never, 50);
    process.emit('SIGHUP');
    expect(await hungUp).toBe('SIGHUP');
    expect(await untilStopped(dir.at('w'), 'n2', Promise.resolve('watch died'), 50)).toBe(
      'watch died'
    );
  });

  test('two ups at once: the check and the claim are one step, so the second is refused', async ({
    dir,
  }) => {
    writeRecord(dir.at('w'), rec(ENDED, true));
    expect(acquireFileLock(recordPath(dir.at('w')))).toBe(true);
    const second = claimFolder(dir.at('w'), 'n2', 'demo').catch((err: unknown) => err);
    writeRecord(dir.at('w'), rec(process.ppid, true));
    releaseFileLock(recordPath(dir.at('w')));
    expect(await second).toMatchObject({ code: 'already_running' });
    removeRecord(dir.at('w'));
    expect(await claimFolder(dir.at('w'), 'n3', 'demo')).toBeNull();
    expect(readRecord(dir.at('w'))).toMatchObject({ nonce: 'n3', added: false });
  });

  test('a down that holds the lock while up rewrites its record wins: up is cancelled', async ({
    dir,
  }) => {
    const mine = rec(process.pid, true);
    writeRecord(dir.at('w'), mine);
    expect(acquireFileLock(recordPath(dir.at('w')))).toBe(true);
    const rewrite = rewriteRecord(dir.at('w'), mine).catch((err: unknown) => err);
    removeRecord(dir.at('w'));
    releaseFileLock(recordPath(dir.at('w')));
    expect(await rewrite).toMatchObject({ code: 'cancelled' });
    expect(readRecord(dir.at('w'))).toBeNull();
  });

  test('an orphan tsc of an up that ended is stopped when proven; a reused pid is not signalled', async ({
    dir,
  }) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
    const exited = new Promise((done) => child.once('exit', (_c, signal) => done(signal)));
    const tsc = markOf(child.pid) ?? undefined;
    writeRecord(dir.at('w'), rec(ENDED, false, undefined, { pid: child.pid ?? 0, started: 'x' }));
    const reused = await output(() => stopLocal(dir.at('w')));
    expect(reused.stderr).toBe('');
    writeRecord(dir.at('w'), rec(ENDED, false, undefined, tsc));
    const run = await output(async () => void refuseRunning(dir.at('w')));
    expect(run.stderr).toContain(`stopped   the tsc watch (pid ${child.pid}) of an up that ended`);
    expect(await exited).toBe('SIGTERM');
  });
});
