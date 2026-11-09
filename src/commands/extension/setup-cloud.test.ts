import { rmSync } from 'node:fs';
import { describe, expect } from 'vitest';
import {
  connected,
  editDeps,
  fakeAccount,
  profileCalls,
  profileRequests,
  type FakeAccount,
} from '../../test/account.js';
import { output, pkg, test } from '../../test/config-dir.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup } from './setup.js';

const HELLO_OK = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const DEFAULT = { version: 1, extensions: {}, config: {}, machines: {} };
const HELLO_DOC = { version: 1, extensions: { [pkg('hello')]: '^1.0.0' } };
const HELLO = { hello: '^1.0.0' };

const NO_PLATFORM = 'FAIL discovery: https://x.test/.well-known/agentage.json has no "platform"';

// Signed in already; besides npm, the account is all this flow reaches.
const setup = (account: FakeAccount | null, opts: SetupOptions = {}) =>
  output(() =>
    runExtensionSetup(opts, {
      ensureSignedIn: async () => 'already',
      signOut: async () => console.log('(signed out)'),
      printStatus: async () => undefined,
      ...editDeps(account),
    })
  );

describe('agentage setup, signed in, and the profile in the account', () => {
  test('a site whose discovery names no platform fails setup with the document URL, registering nothing', async () => {
    const account = fakeAccount();
    const failing = () => ({
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
      expect.stringMatching(/^install {4}no extensions in tree \w+ \(npm skipped\)$/),
      'profile    created in your account (etag "etag-0001")',
      expect.stringMatching(/^registered m_[0-9a-f]{8} at https:\/\/platform\.test$/),
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
    expect(account.stored).toMatchObject({
      profile: { extensions: HELLO_DOC.extensions },
      lock: { packages: { [`node_modules/${pkg('hello')}`]: { version: '1.0.0' } } },
      npmMajor: 10,
    });
  });

  test('pulls the profile the account holds, installs and loads it, and pushes nothing', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = account.store(HELLO_DOC);
    const run = await setup(account);
    expect(run.lines).toEqual([
      `profile    pulled from your account (etag ${etag})`,
      expect.stringMatching(/^install {4}1 extension in tree \w+ \(npm install\)$/),
      HELLO_OK,
      expect.stringMatching(/^registered m_/),
    ]);
    expect(profileCalls(account)).toEqual(['GET 200']);
    expect(dir.json('profile.json')['extensions']).toEqual(HELLO_DOC.extensions);
    expect(dir.json('machine.json')).toMatchObject({ profileSource: 'cloud', profileEtag: etag });
  });

  test('installs with the lock the account holds: npm ci, the same tree as the machine that pushed it', async ({
    dir,
  }) => {
    const account = fakeAccount();
    account.store(HELLO_DOC);
    await setup(account);
    const tree = dir.file('extensions/current');
    account.store(HELLO_DOC, dir.json('extensions/package-lock.json'), 10);
    rmSync(dir.at('extensions'), { recursive: true });
    const run = await setup(account);
    expect(run.lines).toContain(`install    1 extension in tree ${tree} (npm ci)`);
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
    expect(run).toMatchObject({ lines: [expect.stringMatching(/^registered /)], error: null });
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
    dir.profile({ extensions: HELLO });
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
