import { describe, expect } from 'vitest';
import { MACHINE_ID, output, pkg, test } from '../../test/config-dir.js';
import { npmFromFixtures } from '../../test/npm-fixtures.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup, type ExtensionSetupDeps } from './setup.js';

// Sign-in, sign-out and the status report reach the site: these stand-ins say what they did.
const deps: ExtensionSetupDeps = {
  ensureSignedIn: async () => {
    console.log('(signed in)');
    return 'already';
  },
  signOut: async () => console.log('(signed out)'),
  printStatus: async () => console.log('(status)'),
  npm: npmFromFixtures,
};

const setup = (opts: SetupOptions) => output(() => runExtensionSetup(opts, deps));

describe('agentage setup --profile', () => {
  test("keeps this machine's own off list from the local profile.json", async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' }, off: ['hello'] });
    const next = dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } }, 'next.json');
    const run = await setup({ profile: next });
    expect(run.error).toBeNull();
    expect(dir.json('profile.json')['machines']).toEqual({
      [MACHINE_ID]: { off: [pkg('hello')], config: {} },
    });
    expect(run.lines).toContain(
      'hello  off        @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
  });

  test('refuses a file it cannot read or parse, and a URL, writing nothing', async ({ dir }) => {
    dir.write('junk.json', '{ nope');
    expect((await setup({ profile: dir.at('gone.json') })).error).toMatch(
      /^cannot read profile .*gone\.json: ENOENT/
    );
    expect((await setup({ profile: dir.at('junk.json') })).error).toBe(
      `${dir.at('junk.json')} is invalid:\n  not valid JSON`
    );
    expect((await setup({ profile: 'https://example.com/p.json' })).error).toBe(
      'https://example.com/p.json: profile URLs are not supported; pass a file path'
    );
    expect(dir.list('')).toEqual(['junk.json']);
  });

  test('--disconnect signs out and ignores --profile', async ({ dir }) => {
    expect((await setup({ disconnect: true, profile: dir.at('two.json') })).lines).toEqual([
      '(signed out)',
    ]);
  });
});

describe('agentage setup --profile, after installing', () => {
  test('loads the extensions, prints ok and failed rows, and fails naming each that failed', async ({
    dir,
  }) => {
    const run = await setup({
      profile: dir.profile({ extensions: { hello: '^1.0.0', throws: '^1' } }, 'p.json'),
    });
    expect(run.lines).toContain(
      'hello   ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
    expect(run.lines).toContain(
      'throws  failed     @agentage/fixture-throws 1.0.0 (wants ^1)  "boom"'
    );
    expect(run.error).toBe('1 extension failed to load: throws');
  });

  test('lists the secrets to set before it loads', async ({ dir }) => {
    const run = await setup({ profile: dir.profile({ extensions: { secret: '^1' } }, 'p.json') });
    expect(run.lines.slice(1)).toEqual([
      'secrets to set: secret.token',
      'secret  ok         @agentage/fixture-secret 1.0.0 (wants ^1)',
    ]);
  });

  test('loads nothing when npm fails: the rows show what is still current', async ({ dir }) => {
    const run = await setup({ profile: dir.profile({ extensions: { absent: '^1' } }, 'p.json') });
    expect(run.error).toMatch(/^npm install failed/);
    expect(run.lines).toEqual([
      '?  missing    add  @agentage/fixture-absent - (wants ^1)  not installed in the current tree',
    ]);
    expect(dir.exists('state')).toBe(false);
  });
});

describe('agentage setup', () => {
  test('reports status with AGENTAGE_TOKEN, which loading removed from the environment', async ({
    dir,
  }) => {
    process.env['AGENTAGE_TOKEN'] = 'aga_unit';
    dir.profile({ extensions: { hello: '^1.0.0' } });
    const printStatus = async (opts: { token?: string } = {}) =>
      console.log(`(status with ${opts.token})`);
    const run = await output(() => runExtensionSetup({}, { ...deps, printStatus }));
    expect(run.lines).toContain('(status with aga_unit)');
    expect(process.env['AGENTAGE_TOKEN']).toBeUndefined();
  });

  test('prints status after signing in, even when profile.json is invalid, then fails', async ({
    dir,
  }) => {
    dir.write('profile.json', { version: 0 });
    expect(await setup({})).toMatchObject({
      lines: ['(signed in)', '(status)'],
      error: 'profile.json is invalid:\n  version: must be 1 (got 0)',
    });
  });
});
