import { fakeHost, marketRow } from '../../test/host.js';
import { CliError } from '../../lib/json-output.js';
import { describe, expect, vi } from 'vitest';
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
  host: async () => fakeHost().host,
  updateExtensions: async () => undefined,
  npm: npmFromFixtures,
  ...noAccount,
};

const setup = (opts: SetupOptions) => output(() => runExtensionSetup(opts, deps));

describe('agentage setup --profile', () => {
  test("keeps this machine's own off list from the local profile.json", async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' }, off: ['hello'] });
    const next = dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } }, 'next.json');
    await setup({ profile: next });
    expect(dir.json('profile.json')['machines']).toEqual({
      [MACHINE_ID]: { off: [pkg('hello')], config: {} },
    });
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

describe('agentage setup --profile installs through the daemon', () => {
  const HELLO = '@agentage/extension-hello';

  test('each entry by id (an exact version as it is); the cli loads nothing', async ({ dir }) => {
    const daemon = fakeHost();
    dir.write('p.json', {
      version: 1,
      extensions: { [HELLO]: '^1.0.0', '@agentage/extension-world': '2.1.0' },
    });
    const file = dir.at('p.json');
    const run = await output(() =>
      runExtensionSetup({ profile: file }, { ...deps, host: async () => daemon.host })
    );
    expect(run.error).toBeNull();
    expect(vi.mocked(daemon.host.add).mock.calls).toEqual([
      [{ id: 'hello' }],
      [{ id: 'world', version: '2.1.0' }],
    ]);
    expect(dir.exists('extensions')).toBe(false);
    expect(dir.json('machine.json')).toMatchObject({ profileSource: 'file' });
  });

  test('a failed entry is reported and the others install', async ({ dir }) => {
    const daemon = fakeHost();
    vi.mocked(daemon.host.add).mockRejectedValueOnce(new CliError('NOT_FOUND', 'no hello'));
    const extensions = { [HELLO]: '^1', '@agentage/extension-world': '^2' };
    dir.write('p.json', { version: 1, extensions });
    const file = dir.at('p.json');
    const run = await output(() =>
      runExtensionSetup({ profile: file }, { ...deps, host: async () => daemon.host })
    );
    expect(run.error).toBe('not installed:\n  hello: no hello');
    expect(daemon.host.add).toHaveBeenCalledWith({ id: 'world' });
  });

  test('never gated: installs the entries not installed yet, reports the others as already installed', async ({
    dir,
  }) => {
    const daemon = fakeHost([marketRow('hello', '0.7.0')]);
    dir.write('setup.profile-installed', '');
    dir.write('p.json', {
      version: 1,
      extensions: { [HELLO]: '^1', '@agentage/extension-world': '^2' },
    });
    const file = dir.at('p.json');
    const run = await output(() =>
      runExtensionSetup({ profile: file }, { ...deps, host: async () => daemon.host })
    );
    expect(run.lines).toContain('hello already installed');
    expect(vi.mocked(daemon.host.add).mock.calls).toEqual([[{ id: 'world' }]]);
  });

  test('with the daemon off it installs nothing and says so', async ({ dir }) => {
    dir.write('p.json', { version: 1, extensions: { [HELLO]: '^1' } });
    const run = await setup({ profile: dir.at('p.json'), daemon: false });
    expect(run.lines).toContain('extensions the daemon is off, nothing installed');
    expect(dir.exists('setup.profile-installed')).toBe(false);
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

  test('reports status with AGENTAGE_TOKEN; setup loads no extension code itself', async ({
    dir,
  }) => {
    process.env['AGENTAGE_TOKEN'] = 'aga_unit';
    dir.profile({ extensions: { hello: '^1.0.0' } });
    const printStatus = async (opts: { token?: string } = {}) =>
      console.log(`(status with ${opts.token})`);
    const run = await output(() => runExtensionSetup({}, { ...deps, printStatus }));
    expect(run.lines).toContain('(status with aga_unit)');
    delete process.env['AGENTAGE_TOKEN'];
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

  test('setup --latest names its new command on stderr and runs extension update', async () => {
    const updateExtensions = vi.fn(async () => undefined);
    const run = await output(() =>
      runExtensionSetup({ latest: true }, { ...deps, updateExtensions })
    );
    expect(run.stderr).toBe('setup --latest is now: agentage extension update');
    expect(updateExtensions).toHaveBeenCalledOnce();
  });
});
