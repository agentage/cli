import { rmSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { MACHINE_ID, output, test, type ConfigDir } from '../../test/config-dir.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup, type ExtensionSetupDeps } from './setup.js';

// --dry-run and --check never reach the site or the daemon: these stand-ins fail if called.
const never = async (): Promise<never> => {
  throw new Error('reached the site');
};

const deps: ExtensionSetupDeps = {
  ensureSignedIn: never,
  signOut: never,
  printStatus: never,
  startDaemon: never,
  host: never,
  updateExtensions: never,
  npm: never,
  npmMajor: never,
  account: never,
};

const setup = (opts: SetupOptions) => output(() => runExtensionSetup(opts, deps));

const A = '@agentage/extension-alpha';
const B = '@agentage/extension-beta';
const C = '@agentage/extension-gamma';

// profile.json with three entries, gamma off on this machine; alpha already in installation.json.
const machineWith = (dir: ConfigDir): void => {
  dir.machine({});
  const machines = { [MACHINE_ID]: { off: [C], config: {} } };
  dir.write('profile.json', {
    version: 1,
    extensions: { [A]: '^1', [B]: '2.0.0', [C]: '^3' },
    machines,
  });
  dir.write('installation.json', {
    host: 'local',
    extensions: [{ id: 'alpha', version: '1.0.0' }],
  });
};

describe('agentage setup --dry-run: what setup would send to the daemon', () => {
  test('add, off (installed disabled) and already installed; nothing written', async ({ dir }) => {
    machineWith(dir);
    const before = dir.list('');
    const run = await setup({ dryRun: true });
    expect(run.lines.slice(2)).toEqual([
      `+ add ${B} 2.0.0`,
      `o off ${C} ^3 (installed disabled)`,
      'plan: 1 to add, 1 off, 1 already installed',
    ]);
    expect(dir.list('')).toEqual(before);
  });

  test('--json keeps the plan shape: extensions with verb, name, wanted, current; summary', async ({
    dir,
  }) => {
    machineWith(dir);
    const plan = JSON.parse((await setup({ dryRun: true, json: true })).stdout);
    expect(plan.extensions).toEqual([
      { verb: 'unchanged', name: A, wanted: '^1', current: 'installed' },
      { verb: 'add', name: B, wanted: '2.0.0', current: null },
      { verb: 'off', name: C, wanted: '^3', current: null },
    ]);
    expect(plan.summary).toEqual({ add: 1, update: 0, remove: 0, off: 1, unchanged: 1 });
  });

  test('once the account profile was installed, plain setup would install nothing; --profile still would', async ({
    dir,
  }) => {
    machineWith(dir);
    dir.write('setup.profile-installed', '');
    expect((await setup({ dryRun: true })).lines.slice(2)).toEqual(['plan: nothing to change']);
    const file = dir.at('p.json');
    dir.write('p.json', { version: 1, extensions: { [B]: '2.0.0' } });
    expect((await setup({ profile: file, dryRun: true })).lines.slice(2)).toEqual([
      `+ add ${B} 2.0.0`,
      'plan: 1 to add, 0 off, 0 already installed',
    ]);
  });

  test('of a profile from a newer schema warns, prints the plan and writes nothing', async ({
    dir,
  }) => {
    const path = dir.at('v2.json');
    dir.write('v2.json', { version: 2, extensions: { [A]: '^1' } });
    const run = await setup({ profile: path, dryRun: true });
    expect(run.stderr).toBe(
      'warning: version: 2 is newer than this CLI understands (1); read-only'
    );
    expect(run.lines).toEqual([
      'dry run    nothing written',
      'registry   default  https://registry.npmjs.org',
      `+ add ${A} ^1`,
      'plan: 1 to add, 0 off, 0 already installed',
    ]);
    expect(dir.list('')).toEqual(['v2.json']);
  });
});

describe('agentage setup --check', () => {
  test('with entries to install prints the plan and fails "not converged"', async ({ dir }) => {
    machineWith(dir);
    const run = await setup({ check: true });
    expect(run.error).toBe('not converged: 1 to add, 1 to install disabled');
  });

  test('with every entry installed passes; no machine.json is a problem in --json', async ({
    dir,
  }) => {
    machineWith(dir);
    dir.write('setup.profile-installed', '');
    expect(await setup({ check: true })).toMatchObject({
      lines: ['plan: nothing to change'],
      error: null,
    });
    rmSync(dir.at('machine.json'));
    const run = await setup({ check: true, json: true });
    expect(JSON.parse(run.stdout).problems).toEqual(['machine.json: missing']);
    expect(run.error).toBe('machine.json: missing');
  });
});
