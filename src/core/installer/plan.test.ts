import { rmSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { pkg, test } from '../../test/config-dir.js';
import { npmFromFixtures } from '../../test/npm-fixtures.js';
import { install } from './installer.js';
import { currentDependencies, lockDrift, pendingChanges, planChanges } from './plan.js';

const [HELLO, WORLD, SECRET] = [pkg('hello'), pkg('world'), pkg('secret')];
const TWO = { [HELLO]: '^1.0.0', [WORLD]: '^1' };

const verbs = (desired: Record<string, string>, current: Record<string, string>) =>
  planChanges({ install: desired, off: [] }, current).extensions.map((e) => `${e.verb} ${e.name}`);

describe('the plan: the profile against the current tree', () => {
  test('adds what the tree lacks, removes what the profile dropped, keeps the rest, by package name', () => {
    expect(verbs({ [HELLO]: '^1.0.0', [SECRET]: '^1' }, TWO)).toEqual([
      `unchanged ${HELLO}`,
      `add ${SECRET}`,
      `remove ${WORLD}`,
    ]);
  });

  test('updates a package whose range or URL differs from the one the tree was installed with', () => {
    const plan = planChanges({ install: { [HELLO]: '~1.0.0' }, off: [] }, { [HELLO]: '^1.0.0' });
    expect(plan.extensions).toEqual([
      { verb: 'update', name: HELLO, wanted: '~1.0.0', current: '^1.0.0' },
    ]);
  });

  test('counts an installed package turned off here as off, never as a change', () => {
    const plan = planChanges({ install: TWO, off: [HELLO] }, TWO);
    expect(plan.summary).toEqual({ add: 0, update: 0, remove: 0, off: 1, unchanged: 1 });
    expect(pendingChanges(plan.summary)).toEqual([]);
  });

  test('sums every verb, and only add, update and remove are pending', () => {
    const plan = planChanges({ install: { [HELLO]: '~1', [SECRET]: '^1' }, off: [] }, TWO);
    expect(plan.summary).toEqual({ add: 1, update: 1, remove: 1, off: 0, unchanged: 0 });
    expect(pendingChanges(plan.summary)).toEqual(['1 to add', '1 to update', '1 to remove']);
  });

  test("reads the current tree from the lock's root dependencies, also when a reinstall reused it", async () => {
    expect(currentDependencies()).toEqual({});
    await install({ extensions: TWO, registries: {} }, npmFromFixtures);
    expect(currentDependencies()).toEqual(TWO);
    const tilde = { ...TWO, [HELLO]: '~1.0.0' };
    await install({ extensions: tilde, registries: {} }, npmFromFixtures);
    expect(currentDependencies()).toEqual(tilde);
    expect(lockDrift()).toEqual({ integrity: [], matches: true });
  });

  test('is empty when extensions/current names a tree that never finished', async ({ dir }) => {
    const { tree } = await install({ extensions: TWO, registries: {} }, npmFromFixtures);
    rmSync(dir.at(`extensions/trees/${tree}/.complete`));
    expect(currentDependencies()).toEqual({});
  });
});

describe('the lock on disk against the lock inside the current tree', () => {
  test('agree after an install, and with no tree and no lock at all', async () => {
    expect(lockDrift()).toEqual({ integrity: [], matches: true });
    await install({ extensions: TWO, registries: {} }, npmFromFixtures);
    expect(lockDrift()).toEqual({ integrity: [], matches: true });
  });

  test('name every name@version whose integrity differs as integrity drift', async ({ dir }) => {
    await install({ extensions: TWO, registries: {} }, npmFromFixtures);
    const lock = dir.json('extensions/package-lock.json') as { packages: Record<string, object> };
    lock.packages[`node_modules/${HELLO}`] = { version: '1.0.0', integrity: 'sha512-x' };
    dir.write('extensions/package-lock.json', lock);
    expect(lockDrift()).toEqual({ integrity: [`${HELLO}@1.0.0`], matches: false });
  });

  test('do not match when the lock on disk is gone or names other packages', async ({ dir }) => {
    await install({ extensions: TWO, registries: {} }, npmFromFixtures);
    const lock = dir.json('extensions/package-lock.json') as { packages: Record<string, object> };
    delete lock.packages[`node_modules/${WORLD}`];
    dir.write('extensions/package-lock.json', lock);
    expect(lockDrift()).toEqual({ integrity: [], matches: false });
    dir.write('extensions/package-lock.json', 'gone');
    expect(lockDrift().matches).toBe(false);
  });
});
