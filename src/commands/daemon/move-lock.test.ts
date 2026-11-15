import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sleep } from '../../lib/wait.js';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { runDaemonStatus } from './daemon.js';
import { MOVE_REPORT, MOVED_MARKER, moveBeforeStart, moveOldLists } from './move.js';

const oldFolder = (dir: ConfigDir) => {
  dir.machine({ [pkg('probe')]: fixture('probe') });
  dir.profile({ extensions: { hello: '^1.0.0' } });
  dir.tree('hello');
};

let sleeper: ChildProcess;
beforeAll(() => {
  sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
});
afterAll(() => void sleeper.kill('SIGKILL'));

describe('the move calls the kit functions', () => {
  it('the bundled kit ships updateInstallation and withFileLock (kit-lock.ts is gone)', async () => {
    const host = await import('@agentage/extension/host');
    expect(host.capabilities).toEqual(
      expect.arrayContaining(['updateInstallation', 'withFileLock'])
    );
    expect(typeof host.updateInstallation).toBe('function');
  });
});

describe('the move writes under the daemon lock', () => {
  // The holder is another live process, as a serving daemon is: no event or timing race decides it.
  test('waits while another live process holds the lock, then moves every row', async ({ dir }) => {
    oldFolder(dir);
    dir.write('installation.json.lock', String(sleeper.pid));
    let done = false;
    const moving = output(() => moveOldLists()).then(() => void (done = true));
    await sleep(300);
    expect(done || dir.exists('installation.json'), 'the move did not wait for the lock').toBe(
      false
    );
    rmSync(dir.at('installation.json.lock'));
    await moving;
    expect(dir.json('installation.json')['extensions']).toHaveLength(2);
    expect(dir.exists(MOVED_MARKER)).toBe(true);
  });

  test('a live holder past the wait is a refusal naming it; the lock stays', async ({ dir }) => {
    const { withFileLock } = await import('@agentage/extension/host');
    dir.write('installation.json.lock', String(sleeper.pid));
    const err = await withFileLock(dir.at('installation.json'), () => 1, 50).catch(
      (e: unknown) => e
    );
    expect((err as Error).message).toContain(`locked by process ${sleeper.pid}`);
    expect(existsSync(dir.at('installation.json.lock'))).toBe(true);
  });

  test('another live daemon on the folder is no move warning: it ends the start', async ({
    dir,
  }) => {
    oldFolder(dir);
    const refused = Object.assign(new Error('a daemon runs'), { code: 'DAEMON_RUNNING' });
    const kit = async () => ({
      updateInstallation: vi.fn(async () => Promise.reject(refused)),
      withFileLock: vi.fn(),
    });
    const run = await output(() => moveBeforeStart({ kit }));
    expect(run.error, 'rethrown, not a move warning').toBe('a daemon runs');
    expect(dir.exists(MOVE_REPORT)).toBe(false);
    expect(dir.exists(MOVED_MARKER)).toBe(false);
  });

  test('a move that fails does not stop the daemon start: no marker, the reason in status', async ({
    dir,
  }) => {
    oldFolder(dir);
    const held = vi.fn(async () => {
      throw Object.assign(new Error('installation.json is locked by process 7: waited 5000 ms'), {
        code: 'UNAVAILABLE',
      });
    });
    const kit = async () => ({ updateInstallation: held, withFileLock: vi.fn() });
    const run = await output(() => moveBeforeStart({ kit }));
    expect(run.code).toBeNull();
    const warning =
      'the move stopped (installation.json is locked by process 7: waited 5000 ms); ' +
      'the next daemon start tries again';
    expect(run.stderr).toBe(`move: ${warning}`);
    expect(dir.exists(MOVED_MARKER)).toBe(false);
    const status = await output(() => runDaemonStatus(async () => ({ kind: 'none' })));
    expect(status.lines).toContain(`move: ${warning}`);
    await output(() => moveBeforeStart());
    expect(dir.exists(MOVED_MARKER)).toBe(true);
  });

  test('an installation.json or settings.json that does not parse moves nothing, no marker', async ({
    dir,
  }) => {
    for (const file of ['installation.json', 'settings.json']) {
      oldFolder(dir);
      dir.write(file, '{ half');
      const run = await output(() => moveOldLists());
      expect(run.stderr).toBe(
        `move: ${file} does not parse; nothing moved, fix it and restart the daemon`
      );
      expect(dir.file(file)).toBe('{ half');
      expect(dir.exists(MOVED_MARKER)).toBe(false);
      dir.write(file, '{}');
    }
  });

  test('a move report of another shape is not shown', async ({ dir }) => {
    for (const bad of [{ moved: 'x' }, { moved: [], skipped: [{ entry: 1 }], warning: null }]) {
      dir.write(MOVE_REPORT, bad);
      const status = await output(() => runDaemonStatus(async () => ({ kind: 'none' })));
      expect(status.lines).toEqual(['daemon: not running']);
    }
  });
});
