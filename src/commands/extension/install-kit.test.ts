import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, vi } from 'vitest';
import { noAccount } from '../../test/account.js';
import { fixture, output, pkg, test } from '../../test/config-dir.js';
import { manifestFromFixtures, npmFromFixtures } from '../../test/npm-fixtures.js';
import { runExtensionInstall, type ExtensionInstallDeps } from './install.js';

// The kit fixtures range over kit ^0.2, whatever kit is installed here.
vi.mock('../../core/kit-version.js', () => ({ kitVersion: () => '0.2.0' }));

// The kit's checkCli: pong's handlers are fine unless a test says otherwise.
const kit = vi.hoisted(() => ({ problem: null as string | null }));
vi.mock('@agentage/extension/tool', () => ({
  checkCli: async (dir: string) => (dir.endsWith('extension-pong') ? kit.problem : null),
}));

const deps: ExtensionInstallDeps = {
  npm: npmFromFixtures,
  manifest: manifestFromFixtures(),
  ...noAccount,
};

const install = (name: string) => output(() => runExtensionInstall({ name }, deps));

const installed = (how: string) =>
  expect.stringMatching(new RegExp(`^install {4}no extensions in tree [0-9a-f]{16} \\(${how}\\)$`));
const INSTALL = installed('npm skipped');
const PROBE_OK = 'probe  ok         @agentage/fixture-probe 0.2.0 (dev)  commands: ping';

describe('agentage extension install <path> of a working copy built on the kit', () => {
  afterEach(() => {
    kit.problem = null;
  });

  test('links it: one linked line, the rows with probe ok and its top-level command', async ({
    dir,
  }) => {
    const run = await install(fixture('probe'));
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'linked     @agentage/fixture-probe (working copy)',
      INSTALL,
      PROBE_OK,
    ]);
    expect(dir.json('machine.json')['dev']).toEqual({
      [pkg('probe')]: realpathSync(fixture('probe')),
    });
    expect(dir.json('commands.json')).toEqual({ ping: pkg('probe') });
    expect(dir.exists('profile.json')).toBe(false);
  });

  test('a later install whose command is taken keeps only the namespaced form, and says so', async ({
    dir,
  }) => {
    await install(fixture('probe'));
    const run = await install(fixture('pong'));
    expect(run.lines).toEqual([
      'linked     @agentage/fixture-pong (working copy)',
      installed('reused'),
      'pong   ok         @agentage/fixture-pong 0.2.0 (dev)  commands: pong ping, pong status',
      PROBE_OK,
      'namespaced agentage pong ping (agentage ping is taken by extension probe)',
      'namespaced agentage pong status (agentage status is a core command)',
    ]);
    expect(dir.json('commands.json')).toEqual({ ping: pkg('probe') });
  });

  test('installing either one again changes nothing: the first install holds the name, not the order on disk', async ({
    dir,
  }) => {
    await install(fixture('probe'));
    await install(fixture('pong'));
    const real = (name: string) => realpathSync(fixture(name));
    dir.machine({ pong: real('pong'), probe: real('probe') });
    for (const again of [fixture('probe'), fixture('pong')])
      expect((await install(again)).lines).toContain(
        'namespaced agentage pong ping (agentage ping is taken by extension probe)'
      );
    expect(dir.json('commands.json')).toEqual({ ping: pkg('probe') });
  });

  test('fails naming it when the kit finds its handlers wrong, after printing the rows', async () => {
    kit.problem = 'status is declared but has no handler';
    const run = await install(fixture('pong'));
    expect(run.lines).toContain(
      'pong  failed     @agentage/fixture-pong 0.2.0 (dev)  commands: ping, pong status  "status is declared but has no handler"'
    );
    expect(run.error).toBe('1 extension failed to load: pong');
  });
});
