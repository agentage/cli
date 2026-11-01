import { describe, expect } from 'vitest';
import { pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { npmFromFixtures, npmPublishing, type Publishes } from '../../test/npm-fixtures.js';
import { install, type InstallSet } from './installer.js';
import { updateLatest, type Staged } from './latest.js';
import { type Npm } from './npm.js';

const [HELLO, WORLD] = [pkg('hello'), pkg('world')];
const ONE: InstallSet = { extensions: { [HELLO]: '^1.0.0' }, registries: {} };
const TWO: InstallSet = { extensions: { [HELLO]: '^1.0.0', [WORLD]: '^1' }, registries: {} };
const NEEDS_2 = { engines: { agentage: '^2' } };

const npmNeverRuns = async (): Promise<Npm> => {
  throw new Error('npm must not run');
};

interface Checked extends Staged {
  // What extensions/current named while the new tree was checked.
  current: string;
}

// The check setup --latest runs before the tree becomes current: here it records what it saw.
const checking = (dir: ConfigDir, answer: boolean) => {
  const seen: Checked[] = [];
  const check = async (staged: Staged): Promise<boolean> => {
    seen.push({ ...staged, current: dir.file('extensions/current') });
    return answer;
  };
  return { seen, check };
};

const lockedVersion = (dir: ConfigDir, name: string): unknown =>
  (dir.json('extensions/package-lock.json') as { packages: Record<string, { version: string }> })
    .packages[`node_modules/${name}`]?.version;

const latest = (set: InstallSet, more: Publishes, check: (s: Staged) => Promise<boolean>) =>
  updateLatest(set, npmPublishing(more), check);

describe('setup --latest: the newest versions the profile allows', () => {
  test('npm update runs in a staging tree; the new tree is checked before it becomes current, then it is the only one left', async ({
    dir,
  }) => {
    const old = await install(ONE, npmFromFixtures);
    const { seen, check } = checking(dir, true);
    const result = await latest(ONE, { [HELLO]: { '1.0.1': {} } }, check);
    const change = { name: HELLO, from: '1.0.0', to: '1.0.1' };
    expect(result).toEqual({
      changes: [change],
      held: [],
      unchanged: 0,
      tree: expect.stringMatching(/^[0-9a-f]{16}$/),
      current: true,
    });
    expect(seen).toEqual([
      {
        changes: [change],
        held: [],
        unchanged: 0,
        tree: result.tree,
        dir: dir.at(`extensions/trees/${result.tree}`),
        current: old.tree,
      },
    ]);
    expect(dir.file('extensions/current')).toBe(result.tree);
    expect(dir.list('extensions/trees')).toEqual([result.tree]);
    expect(lockedVersion(dir, HELLO)).toBe('1.0.1');
    expect(dir.json('extensions/package.json')['dependencies']).toEqual(ONE.extensions);
  });

  test('with nothing newer builds no tree and checks nothing', async ({ dir }) => {
    const old = await install(TWO, npmFromFixtures);
    const { seen, check } = checking(dir, true);
    const result = await latest(TWO, {}, check);
    expect(result).toEqual({ changes: [], held: [], unchanged: 2, tree: null, current: false });
    expect(seen).toEqual([]);
    expect(dir.list('extensions/trees')).toEqual([old.tree]);
  });

  test('a new tree that fails the check is removed, and the old one stays current', async ({
    dir,
  }) => {
    const old = await install(ONE, npmFromFixtures);
    const { check } = checking(dir, false);
    const result = await latest(ONE, { [HELLO]: { '1.0.1': {} } }, check);
    expect(result).toMatchObject({ current: false, tree: expect.any(String) });
    expect(dir.file('extensions/current')).toBe(old.tree);
    expect(dir.list('extensions/trees')).toEqual([old.tree]);
    expect(lockedVersion(dir, HELLO)).toBe('1.0.0');
  });

  test('keeps an extension whose newest allowed version needs another extension API, and still updates the others', async ({
    dir,
  }) => {
    await install(TWO, npmFromFixtures);
    const { check } = checking(dir, true);
    const more: Publishes = { [HELLO]: { '1.1.0': NEEDS_2 }, [WORLD]: { '1.0.1': {} } };
    const result = await latest(TWO, more, check);
    expect(result).toMatchObject({
      changes: [{ name: WORLD, from: '1.0.0', to: '1.0.1' }],
      held: [{ name: HELLO, version: '1.0.0', newer: '1.1.0', engine: '^2' }],
      unchanged: 1,
      current: true,
    });
    expect([lockedVersion(dir, HELLO), lockedVersion(dir, WORLD)]).toEqual(['1.0.0', '1.0.1']);
  });

  test('when the only newer version needs another extension API, there is nothing to update', async ({
    dir,
  }) => {
    const old = await install(ONE, npmFromFixtures);
    const { check } = checking(dir, true);
    const result = await latest(ONE, { [HELLO]: { '1.1.0': NEEDS_2 } }, check);
    expect(result).toEqual({
      changes: [],
      held: [{ name: HELLO, version: '1.0.0', newer: '1.1.0', engine: '^2' }],
      unchanged: 1,
      tree: null,
      current: false,
    });
    expect(dir.list('extensions/trees')).toEqual([old.tree]);
  });

  test('an extension the tree does not have yet is added; one the profile dropped is removed', async ({
    dir,
  }) => {
    await install(ONE, npmFromFixtures);
    const { check } = checking(dir, true);
    const secret = pkg('secret');
    const result = await latest({ extensions: { [secret]: '^1' }, registries: {} }, {}, check);
    expect(result.changes).toEqual([
      { name: HELLO, from: '1.0.0', to: null },
      { name: secret, from: null, to: '1.0.0' },
    ]);
  });

  test('an empty profile has nothing to update and runs no npm', async ({ dir }) => {
    const { check } = checking(dir, true);
    const result = await updateLatest({ extensions: {}, registries: {} }, npmNeverRuns, check);
    expect(result).toEqual({ changes: [], held: [], unchanged: 0, tree: null, current: false });
  });

  test('npm failing leaves current, the trees and the lock as they were', async ({ dir }) => {
    const old = await install(ONE, npmFromFixtures);
    const fails = async (): Promise<Npm> => async () => ({ code: 1, stdout: '', stderr: 'E500' });
    await expect(updateLatest(ONE, fails, checking(dir, true).check)).rejects.toThrow(
      'npm update failed (exit 1); extensions/current is unchanged\nE500'
    );
    expect(dir.file('extensions/current')).toBe(old.tree);
    expect(dir.list('extensions/trees')).toEqual([old.tree]);
  });
});
