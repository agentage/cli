import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync, watch } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { kitFileLock, withKitLock } from '../../lib/fs/kit-lock.js';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { runDaemonStatus } from './daemon.js';
import { MOVE_REPORT, MOVED_MARKER, moveBeforeStart, moveOldLists } from './move.js';

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

// One try each: true when the lock was taken (then given back), false when it was refused.
type TakesOnce = (file: string, inside?: (file: string) => Promise<boolean>) => Promise<boolean>;
const kitTakes: TakesOnce = async (file, inside) => {
  const release = await (await kitLock())(file).catch(() => null);
  if (!release) return false;
  const nested = inside ? await inside(file) : true;
  await release();
  return nested;
};
const copyTakes: TakesOnce = (file, inside) =>
  withKitLock(file, () => (inside ? inside(file) : true), 0).catch(() => false);

let sleeper: ChildProcess;
beforeAll(() => {
  sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
});
afterAll(() => void sleeper.kill('SIGKILL'));

const CASES: [string, () => number | null, boolean][] = [
  ['a dead holder: taken over', deadPid, true],
  ['a live holder: refused', () => sleeper.pid ?? 0, false],
  ['pid 1 (a daemon in a container): live, refused', () => 1, false],
  ['our own pid, a lock this process does not hold: stale, taken', () => process.pid, true],
  ['our own pid, a lock this process holds: refused', () => null, false],
];

describe('the copy of the kit lock decides as the kit lock', () => {
  test.for(CASES)('%s', async ([, pid, takes], { dir }) => {
    const file = dir.at('installation.json');
    for (const takesOnce of [kitTakes, copyTakes]) {
      const holder = pid();
      if (holder !== null) dir.write('installation.json.lock', String(holder));
      const got =
        holder === null ? await takesOnce(file, (f) => takesOnce(f)) : await takesOnce(file);
      expect(got, takesOnce === kitTakes ? 'the kit lock' : 'the copy').toBe(takes);
      rmSync(dir.at('installation.json.lock'), { force: true });
    }
  });
});

describe('kit-lock.ts is a copy until the kit ships its lock', () => {
  it('the installed kit does not ship updateInstallation yet', async () => {
    const host = (await import('@agentage/extension/host')) as { capabilities?: string[] };
    expect(
      host.capabilities?.includes('updateInstallation') ?? false,
      'the kit ships updateInstallation: delete src/lib/fs/kit-lock.ts and call the kit function'
    ).toBe(false);
  });

  it("uses the kit's withFileLock when the kit lists updateInstallation", async () => {
    const withFileLock = vi.fn();
    const ships = { capabilities: ['updateInstallation'], withFileLock };
    expect(await kitFileLock(async () => ships)).toBe(withFileLock);
    expect(await kitFileLock(async () => ({ capabilities: [], withFileLock }))).toBe(withKitLock);
    expect(await kitFileLock(async () => ({}))).toBe(withKitLock);
  });
});

describe('the move writes under the daemon lock', () => {
  test("tries again while the kit's lock is held, and finishes only after it is given back", async ({
    dir,
  }) => {
    oldFolder(dir);
    const events: string[] = [];
    const release = await (await kitLock())(dir.at('installation.json'));
    let tries = 0;
    const tried = new Promise<void>((resolve) => {
      const watcher = watch(dir.at(''), (_kind, name) => {
        if (!name?.startsWith(`installation.json.lock.${process.pid}.`)) return;
        tries += 1;
        if (tries < 3) return;
        watcher.close();
        resolve();
      });
    });
    const moving = output(() => moveOldLists()).then(() => void events.push('moved'));
    await tried;
    events.push('released');
    await release();
    await moving;
    expect(events).toEqual(['released', 'moved']);
    expect(dir.json('installation.json')['extensions']).toHaveLength(2);
  });

  test('a live holder past the wait is a timeout naming it', async ({ dir }) => {
    dir.write('installation.json.lock', String(sleeper.pid));
    const err = await withKitLock(dir.at('installation.json'), () => 1, 2).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'timeout' });
    expect((err as Error).message).toContain(`held by process ${sleeper.pid}`);
    expect(existsSync(dir.at('installation.json.lock'))).toBe(true);
  });

  test('a move that fails does not stop the daemon start: no marker, the reason in status', async ({
    dir,
  }) => {
    oldFolder(dir);
    const held = vi.fn(async () => {
      throw Object.assign(new Error('installation.json is held by process 7; try again'), {
        code: 'timeout',
      });
    });
    const run = await output(() => moveBeforeStart({ lock: async () => held }));
    expect(run.code).toBeNull();
    const warning =
      'the move stopped (installation.json is held by process 7; try again); ' +
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
