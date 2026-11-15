import { CliError } from '../../lib/json-output.js';
import { describe, expect } from 'vitest';
import { noAccount } from '../../test/account.js';
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
  startDaemon: async () => 4243,
  npm: npmFromFixtures,
  ...noAccount,
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
  test('signs in with --reauth and --no-browser as given, then prints status', async () => {
    const ensureSignedIn: ExtensionSetupDeps['ensureSignedIn'] = async (opts) => {
      console.log(`(signed in ${JSON.stringify(opts)})`);
      return 'signed-in';
    };
    const run = await output(() =>
      runExtensionSetup({ reauth: true, browser: false }, { ...deps, ensureSignedIn })
    );
    expect(run.lines[0]).toBe('(signed in {"reauth":true,"browser":false})');
    expect(run.lines.slice(-2)).toEqual(['(status)', 'daemon running on 127.0.0.1:4243']);
  });

  test('starts the daemon last; --no-daemon or AGENTAGE_NO_DAEMON=1 leave it off', async () => {
    const started: number[] = [];
    const startDaemon = async () => (started.push(1), 4243);
    await output(() => runExtensionSetup({}, { ...deps, startDaemon }));
    await output(() => runExtensionSetup({ daemon: false }, { ...deps, startDaemon }));
    process.env['AGENTAGE_NO_DAEMON'] = '1';
    const off = await output(() => runExtensionSetup({}, { ...deps, startDaemon }));
    delete process.env['AGENTAGE_NO_DAEMON'];
    expect(started).toHaveLength(1);
    expect(off.lines).not.toContain('daemon running on 127.0.0.1:4243');
  });

  test('with AGENTAGE_TOKEN set, setup opens no sign-in and still starts the daemon', async () => {
    process.env['AGENTAGE_TOKEN'] = 'aga_unit';
    const run = await output(() => runExtensionSetup({ browser: false }, deps));
    delete process.env['AGENTAGE_TOKEN'];
    expect(run.error).toBeNull();
    expect(run.lines).not.toContain('(signed in)');
    expect(run.lines.at(-1)).toBe('daemon running on 127.0.0.1:4243');
    process.env['AGENTAGE_TOKEN'] = 'aga_unit';
    const reauth = await output(() => runExtensionSetup({ reauth: true }, deps));
    delete process.env['AGENTAGE_TOKEN'];
    expect(reauth.stderr).toContain('--reauth does nothing: AGENTAGE_TOKEN is set');
  });

  test('a daemon that cannot start fails setup (exit 1) after the account step, with its code', async () => {
    const startDaemon = async (): Promise<never> => {
      throw new CliError('port_in_use', 'port 4243 is in use by another program');
    };
    const run = await output(() => runExtensionSetup({}, { ...deps, startDaemon }));
    expect(run).toMatchObject({
      code: 'port_in_use',
      error: 'port 4243 is in use by another program',
    });
    expect(run.lines).toContain('(status)');
  });

  test('a failed sign-in stops setup before the account or the status report', async ({ dir }) => {
    const ensureSignedIn = async (): Promise<never> => {
      throw new Error('authorization failed: access_denied');
    };
    const run = await output(() => runExtensionSetup({}, { ...deps, ensureSignedIn }));
    expect(run).toMatchObject({ lines: [], error: 'authorization failed: access_denied' });
    expect(dir.list('')).toEqual([]);
  });

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
      lines: ['(signed in)', '(status)', 'daemon running on 127.0.0.1:4243'],
      error: 'profile.json is invalid:\n  version: must be 1 (got 0)',
    });
  });
});
