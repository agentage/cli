import { rmSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { npmFromFixtures } from '../../test/npm-fixtures.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup, type ExtensionSetupDeps } from './setup.js';

// --dry-run and --check never reach the site: these stand-ins fail the test if they are called.
const never = async (): Promise<never> => {
  throw new Error('reached the site');
};

const deps: ExtensionSetupDeps = {
  ensureSignedIn: never,
  signOut: never,
  printStatus: never,
  npm: npmFromFixtures,
  npmMajor: never,
  account: () => {
    throw new Error('reached the account');
  },
};

const setup = (opts: SetupOptions) => output(() => runExtensionSetup(opts, deps));

describe('agentage setup --dry-run', () => {
  test('of a profile from a newer schema warns, prints the plan and writes nothing', async ({
    dir,
  }) => {
    const path = dir.profile({ version: 2, extensions: { hello: '^1.0.0' } }, 'v2.json');
    const run = await setup({ profile: path, dryRun: true });
    expect(run.stderr).toBe(
      'warning: version: 2 is newer than this CLI understands (1); read-only'
    );
    expect(run.lines).toEqual([
      'dry run    nothing written',
      'registry   default  https://registry.npmjs.org',
      '+ add @agentage/fixture-hello ^1.0.0',
      'plan: 1 to add, 0 to update, 0 to remove, 0 off, 0 unchanged',
    ]);
    expect(dir.list('')).toEqual(['v2.json']);
  });

  test('after an install prints only what changes: nothing, an update, an off', async ({ dir }) => {
    const two = dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } }, 'two.json');
    expect((await setup({ profile: two })).error).toBeNull();
    const plan = async (opts: SetupOptions) =>
      (await setup({ ...opts, dryRun: true })).lines.slice(2);
    expect(await plan({ profile: two })).toEqual(['plan: nothing to change']);
    const tilde = dir.profile({ extensions: { hello: '~1.0.0', world: '^1' } }, 'tilde.json');
    expect(await plan({ profile: tilde })).toEqual([
      '~ update @agentage/fixture-hello ~1.0.0 (was ^1.0.0)',
      'plan: 0 to add, 1 to update, 0 to remove, 0 off, 1 unchanged',
    ]);
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' }, off: ['world'] });
    expect(await plan({})).toEqual([
      'o off @agentage/fixture-world',
      'plan: 0 to add, 0 to update, 0 to remove, 1 off, 1 unchanged',
    ]);
  });

  test('--json prints the plan object; a package the profile dropped is - remove', async ({
    dir,
  }) => {
    await setup({
      profile: dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } }, 'a.json'),
    });
    const one = dir.profile({ extensions: { hello: '^1.0.0' } }, 'one.json');
    expect((await setup({ profile: one, dryRun: true })).lines.slice(2)).toEqual([
      '- remove @agentage/fixture-world',
      'plan: 0 to add, 0 to update, 1 to remove, 0 off, 1 unchanged',
    ]);
    const json = JSON.parse((await setup({ profile: one, dryRun: true, json: true })).stdout);
    expect(json.summary).toEqual({ add: 0, update: 0, remove: 1, off: 0, unchanged: 1 });
  });

  test('without --profile plans from profile.json, never signing in', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    expect((await setup({ dryRun: true })).lines).toContain('+ add @agentage/fixture-hello ^1.0.0');
  });
});

describe('agentage setup --check', () => {
  const installed = async (dir: ConfigDir) =>
    setup({ profile: dir.profile({ extensions: { hello: '^1.0.0' } }, 'one.json') });

  test('on a converged machine prints "plan: nothing to change", passes and writes nothing', async ({
    dir,
  }) => {
    await installed(dir);
    const before = dir.list('extensions/trees');
    expect(await setup({ check: true })).toMatchObject({
      lines: ['plan: nothing to change'],
      error: null,
    });
    expect(dir.list('extensions/trees')).toEqual(before);
  });

  test('with a change pending prints the plan and fails "not converged", without signing in', async ({
    dir,
  }) => {
    await installed(dir);
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    expect(await setup({ check: true })).toMatchObject({
      lines: [
        '+ add @agentage/fixture-world ^1',
        'plan: 1 to add, 0 to update, 0 to remove, 0 off, 1 unchanged',
      ],
      error: 'not converged: 1 to add',
    });
  });

  test('with integrity drift between the two locks fails naming each name@version', async ({
    dir,
  }) => {
    await installed(dir);
    const lock = dir.json('extensions/package-lock.json') as { packages: Record<string, object> };
    lock.packages[`node_modules/${pkg('hello')}`] = { version: '1.0.0', integrity: 'sha512-x' };
    dir.write('extensions/package-lock.json', lock);
    expect((await setup({ check: true })).error).toBe(`integrity drift: ${pkg('hello')}@1.0.0`);
  });

  test('--json prints the plan object with what else is wrong: no machine.json, a lock that does not match', async ({
    dir,
  }) => {
    await installed(dir);
    const lock = dir.json('extensions/package-lock.json') as { packages: Record<string, object> };
    delete lock.packages[`node_modules/${pkg('hello')}`];
    dir.write('extensions/package-lock.json', lock);
    rmSync(dir.at('machine.json'));
    const run = await setup({ check: true, json: true });
    expect(JSON.parse(run.stdout)).toEqual({
      extensions: [{ verb: 'unchanged', name: pkg('hello'), wanted: '^1.0.0', current: '^1.0.0' }],
      summary: { add: 0, update: 0, remove: 0, off: 0, unchanged: 1 },
      problems: [
        'machine.json: missing',
        'lock mismatch: extensions/package-lock.json does not match the current tree',
      ],
    });
    expect(run.error).toBe(
      'machine.json: missing\nlock mismatch: extensions/package-lock.json does not match the current tree'
    );
    expect(dir.exists('machine.json')).toBe(false);
  });
});
