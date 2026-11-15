import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { withKitLock } from '../../lib/fs/kit-lock.js';
import { sleep } from '../../lib/wait.js';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { runDaemonStatus } from './daemon.js';
import { MOVE_REPORT, MOVED_MARKER, moveOldLists } from './move.js';

// The kit's own lock code, not a copy: the move must wait for the daemon's writer.
const KIT_LOCK = join(
  import.meta.dirname,
  '../../../node_modules/@agentage/extension/dist/host/data-lock.js'
);
type LockDataDir = (file: string) => Promise<() => Promise<void>>;
const kitLock = async (): Promise<LockDataDir> =>
  ((await import(pathToFileURL(KIT_LOCK).href)) as { lockDataDir: LockDataDir }).lockDataDir;

const oldFolder = (dir: ConfigDir) => {
  dir.machine({ [pkg('probe')]: fixture('probe') });
  dir.profile({ extensions: { hello: '^1.0.0' } });
  dir.tree('hello');
};

const deadPid = (): number => spawnSync(process.execPath, ['-e', '']).pid ?? 0;

describe('the move writes under the daemon lock', () => {
  test("waits while the kit's lock on installation.json is held, then adds its rows", async ({
    dir,
  }) => {
    oldFolder(dir);
    const release = await (await kitLock())(dir.at('installation.json'));
    const moving = output(() => moveOldLists());
    await sleep(150);
    expect(dir.exists('installation.json')).toBe(false);
    await release();
    await moving;
    expect(dir.json('installation.json')['extensions']).toHaveLength(2);
  });

  test("a dead holder's lock is taken over", async ({ dir }) => {
    oldFolder(dir);
    dir.write('installation.json.lock', String(deadPid()));
    await output(() => moveOldLists());
    expect(dir.json('installation.json')['extensions']).toHaveLength(2);
    expect(existsSync(dir.at('installation.json.lock'))).toBe(false);
  });

  test('a live holder past the wait is a timeout', async ({ dir }) => {
    dir.write('installation.json.lock', String(process.ppid));
    const err = await withKitLock(dir.at('installation.json'), () => 1, 2).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'timeout' });
    expect((err as Error).message).toContain(`held by process ${process.ppid}`);
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
