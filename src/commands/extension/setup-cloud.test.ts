import { beforeEach, describe, expect, vi } from 'vitest';
import { DaemonError } from '../../lib/json-output.js';
import { fakeHost, marketRow } from '../../test/host.js';
import {
  connected,
  editDeps,
  fakeAccount,
  profileCalls,
  profileRequests,
  type FakeAccount,
} from '../../test/account.js';
import { MACHINE_ID, output, test } from '../../test/config-dir.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup, type ExtensionSetupDeps } from './setup.js';

// The profile's extensions go to the daemon (a fake here), as `extension install` sends them.
const HELLO_OK = 'hello 0.7.0 running';
const DEFAULT = { version: 1, extensions: {}, config: {}, machines: {} };
const HELLO_PKG = '@agentage/extension-hello';
const HELLO_DOC = { version: 1, extensions: { [HELLO_PKG]: '^1.0.0' } };
const HELLO = { [HELLO_PKG]: '^1.0.0' };

const NO_PLATFORM = 'FAIL discovery: https://x.test/.well-known/agentage.json has no "platform"';

let daemon = fakeHost();

// Signed in already; besides the daemon, the account is all this flow reaches.
const setup = (
  account: FakeAccount | null,
  opts: SetupOptions = {},
  more: Partial<ExtensionSetupDeps> = {}
) =>
  output(() =>
    runExtensionSetup(opts, {
      ensureSignedIn: async () => 'already',
      signOut: async () => console.log('(signed out)'),
      printStatus: async () => undefined,
      startDaemon: async () => 4243,
      host: async () => daemon.host,
      updateExtensions: async () => undefined,
      ...editDeps(account),
      ...more,
    })
  );

beforeEach(() => {
  daemon = fakeHost();
});

describe('agentage setup, signed in, and the profile in the account', () => {
  test('a site whose discovery names no platform fails setup with the document URL, registering nothing', async () => {
    const account = fakeAccount();
    const failing = async () => ({
      ...account.account(),
      platform: () => Promise.reject(new Error(NO_PLATFORM)),
    });
    const run = await output(() =>
      runExtensionSetup(
        {},
        {
          ensureSignedIn: async () => 'already',
          signOut: async () => undefined,
          printStatus: async () => undefined,
          startDaemon: async () => 4243,
          host: async () => daemon.host,
          updateExtensions: async () => undefined,
          ...editDeps(account),
          account: failing,
        }
      )
    );
    expect(run.error).toBe(NO_PLATFORM);
    expect(account.requests).toEqual([]);
  });

  test('the first signed-in setup, with no profile in the account, saves the default, installs, then creates it with If-None-Match: *', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const run = await setup(account);
    expect(run.error).toBeNull();
    expect(dir.json('profile.json')).toEqual(DEFAULT);
    expect(profileCalls(account)).toEqual(['GET 404', 'PUT 201']);
    expect(profileRequests(account)[1]).toMatchObject({
      headers: { 'if-none-match': '*' },
      body: { version: 1, profile: DEFAULT, lock: null, npmMajor: null },
    });
    expect(run.lines).toEqual([
      'profile    created in your account (etag "etag-0001")',
      expect.stringMatching(/^registered m_[0-9a-f]{8} at https:\/\/platform\.test$/),
      'daemon running on 127.0.0.1:4243',
    ]);
    expect(dir.json('machine.json')).toMatchObject({
      profileSource: 'cloud',
      profileEtag: '"etag-0001"',
      accountId: 'user_1',
    });
  });

  test("a machine with its own profile.json and none in the account creates the account's from it, with its lock", async ({
    dir,
  }) => {
    dir.profile({ extensions: HELLO });
    const account = fakeAccount();
    expect((await setup(account)).lines).toContain(HELLO_OK);
    expect(daemon.host.add).toHaveBeenCalledWith({ id: 'hello' });
    expect(account.stored).toMatchObject({
      profile: { extensions: HELLO_DOC.extensions },
      lock: null,
      npmMajor: null,
    });
  });

  test('pulls the profile the account holds, installs it through the daemon, and pushes nothing', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = account.store(HELLO_DOC);
    const run = await setup(account);
    expect(run.lines).toEqual([
      `profile    pulled from your account (etag ${etag})`,
      HELLO_OK,
      expect.stringMatching(/^registered m_/),
      'daemon running on 127.0.0.1:4243',
    ]);
    expect(profileCalls(account)).toEqual(['GET 200']);
    expect(dir.json('profile.json')['extensions']).toEqual(HELLO_DOC.extensions);
    expect(dir.json('machine.json')).toMatchObject({ profileSource: 'cloud', profileEtag: etag });
  });

  test('once per machine: an extension installed before is left as it is; the next setup installs nothing', async ({
    dir,
  }) => {
    const account = fakeAccount();
    account.store(HELLO_DOC);
    daemon = fakeHost([marketRow('hello', '0.7.0')]);
    dir.write('installation.json', {
      host: 'local',
      extensions: [{ id: 'hello', version: '0.7.0' }],
    });
    expect((await setup(account)).lines).toContain('hello already installed');
    expect(daemon.host.change).not.toHaveBeenCalled();
    expect(daemon.rows).toEqual([marketRow('hello', '0.7.0')]);
    expect(dir.exists('setup.profile-installed')).toBe(true);
    expect((await setup(account)).lines).toContain(
      'extensions your account profile was installed here already; setup installs nothing (agentage extension install)'
    );
  });

  // The bundled kit lists installDisabled: an off entry never starts, and needs no disable after.
  test("this machine's off entries install disabled: enabled: false on the add", async ({
    dir,
  }) => {
    dir.machine({});
    const account = fakeAccount();
    const machines = { [MACHINE_ID]: { off: [HELLO_PKG], config: {} } };
    account.store({ ...HELLO_DOC, machines });
    await setup(account);
    expect(daemon.host.add).toHaveBeenCalledWith({ id: 'hello', enabled: false });
    expect(daemon.host.change).not.toHaveBeenCalled();
  });

  test('a profile entry the daemon refuses fails setup naming it; a package that is no extension is skipped', async () => {
    const account = fakeAccount();
    account.store({ version: 1, extensions: { [HELLO_PKG]: '^1', '@other/thing': '^1' } });
    vi.mocked(daemon.host.add).mockRejectedValueOnce(new DaemonError('NOT_FOUND', 'no hello'));
    const run = await setup(account);
    expect(run).toMatchObject({ code: 'extension_failed' });
    expect(run.error).toBe(
      'not installed:\n  hello: no hello\nthe next setup tries the profile again'
    );
    expect(run.lines).toContain('@other/thing: not an extension, skipped');
  });

  test('a profile of packages that are no extension only: setup says so and passes', async () => {
    const account = fakeAccount();
    account.store({ version: 1, extensions: { '@other/thing': '^1' } });
    const run = await setup(account);
    expect(run.error).toBeNull();
    expect(run.lines).toContain('@other/thing: not an extension, skipped');
    expect(daemon.host.add).not.toHaveBeenCalled();
  });

  test('with the daemon off, setup pulls the profile and installs nothing', async () => {
    const account = fakeAccount();
    account.store(HELLO_DOC);
    const run = await setup(account, { daemon: false });
    expect(run.lines).toContain('extensions the daemon is off, nothing installed');
    expect(daemon.host.add).not.toHaveBeenCalled();
  });

  test('with the etag of the local copy still current (304), keeps profile.json and installs from it', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = connected(dir, account, HELLO);
    const run = await setup(account);
    expect(profileRequests(account)).toMatchObject([
      { headers: { 'if-none-match': etag }, status: 304 },
    ]);
    expect(run.lines).toContain(HELLO_OK);
  });

  test('with the account unavailable, uses the local profile.json and says why on stderr', async ({
    dir,
  }) => {
    const account = fakeAccount();
    connected(dir, account, HELLO);
    account.fail('profile', 503);
    const run = await setup(account);
    expect(run.error).toBeNull();
    expect(run.stderr).toBe('cloud profile unavailable, using local profile.json (503 INTERNAL)');
    expect(run.lines).toContain(HELLO_OK);
  });

  test('with the account unavailable and no local profile.json, installs nothing, says so on one line and succeeds', async ({
    dir,
  }) => {
    const account = fakeAccount();
    account.fail('profile', 'network');
    const run = await setup(account);
    expect(run).toMatchObject({
      lines: [expect.stringMatching(/^registered /), 'daemon running on 127.0.0.1:4243'],
      error: null,
    });
    expect(run.stderr).toBe(
      'cloud profile unavailable and no local profile.json, nothing installed (fetch failed)'
    );
    expect(dir.exists('profile.json')).toBe(false);
    expect(dir.exists('extensions')).toBe(false);
  });

  test('an invalid local profile.json fails, unless the account has a profile to replace it', async ({
    dir,
  }) => {
    dir.write('profile.json', { version: 0 });
    const account = fakeAccount();
    expect((await setup(account)).error).toBe(
      'profile.json is invalid:\n  version: must be 1 (got 0)'
    );
    account.store(HELLO_DOC);
    expect((await setup(account)).lines).toContain(HELLO_OK);
  });

  test('a profile from a file (setup --profile) is neither pulled nor pushed, and setup says so', async ({
    dir,
  }) => {
    dir.write('profile.json', { version: 1, extensions: HELLO });
    dir.machine({}, { profileSource: 'file' });
    const account = fakeAccount();
    const run = await setup(account);
    expect(run.lines[0]).toBe(
      'profile    from a file (setup --profile), not synced with your account'
    );
    expect(run.lines).toContain(HELLO_OK);
    expect(profileCalls(account)).toEqual([]);
  });

  test('setup --profile makes no call to the account at all', async ({ dir }) => {
    const account = fakeAccount();
    const file = dir.profile({ extensions: {} }, 'p.json');
    expect((await setup(account, { profile: file })).error).toBeNull();
    expect(account.requests).toEqual([]);
  });

  test('signed in to another account than the one this machine is connected to: fails naming both, calling nothing', async ({
    dir,
  }) => {
    const other = fakeAccount('user_2');
    connected(dir, other, HELLO);
    const before = dir.file('profile.json');
    expect((await setup(other)).error).toBe(
      'this machine is connected to account user_1, but you are signed in as user_2; ' +
        'run agentage setup --disconnect, then agentage setup'
    );
    expect(other.requests).toEqual([]);
    expect(dir.file('profile.json')).toBe(before);
  });

  test('a profile another machine created meanwhile (412 on create) is adopted and installed', async ({
    dir,
  }) => {
    const account = fakeAccount();
    account.conflicts.push(() => HELLO_DOC);
    const run = await setup(account);
    expect(profileCalls(account)).toEqual(['GET 404', 'PUT 412']);
    expect(run.lines).toContain(HELLO_OK);
    expect(run.lines).toContain('profile    already in your account (etag "etag-0001")');
    expect(dir.json('machine.json')['profileEtag']).toBe('"etag-0001"');
  });
});
