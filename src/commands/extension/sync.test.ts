import { describe, expect } from 'vitest';
import {
  connected,
  editDeps,
  fakeAccount,
  profileCalls,
  type FakeAccount,
} from '../../test/account.js';
import { fixture, MACHINE_ID, output, pkg, test } from '../../test/config-dir.js';
import { manifestFromFixtures } from '../../test/npm-fixtures.js';
import { runExtensionInstall, type ExtensionInstallOptions } from './install.js';
import { runExtensionRemove, type ConfirmIo } from './remove.js';

const HELLO_OK = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const WORLD_OK = 'world  ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world';
const [HELLO, WORLD] = [pkg('hello'), pkg('world')];

const noTerminal: ConfirmIo = { isTTY: false, prompt: async () => 'n' };

const deps = (account: FakeAccount | null) => ({
  ...editDeps(account),
  manifest: manifestFromFixtures(),
  io: noTerminal,
});

const install = (
  account: FakeAccount | null,
  name: string,
  opts: Omit<ExtensionInstallOptions, 'name'> = {}
) => output(() => runExtensionInstall({ name, ...opts }, deps(account)));

const remove = (account: FakeAccount, name: string) =>
  output(() => runExtensionRemove({ name }, deps(account)));

const addWorld = (doc: Record<string, unknown>) => ({
  ...doc,
  extensions: { ...(doc['extensions'] as object), [WORLD]: '^1' },
});

describe('agentage extension install on a machine connected to an account', () => {
  test('pulls the whole document first, installs and loads, then pushes profile, lock and npm major with If-Match', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = connected(dir, account);
    const run = await install(account, HELLO);
    expect(run.error).toBeNull();
    expect(profileCalls(account)).toEqual(['GET 200', 'PUT 200']);
    expect(account.requests[0]?.headers).toEqual({});
    expect(account.requests[1]?.headers['if-match']).toBe(etag);
    expect(account.requests[1]?.body).toMatchObject({
      version: 1,
      profile: { extensions: { [HELLO]: '^1.0.0' } },
      lock: { packages: { [`node_modules/${HELLO}`]: { version: '1.0.0' } } },
      npmMajor: 10,
    });
    expect(run.lines).toEqual([
      `added      ${HELLO} ^1.0.0`,
      expect.stringMatching(/^install {4}1 extension in tree \w+ \(npm install\)$/),
      HELLO_OK,
      'profile    pushed to your account (etag "etag-0002")',
    ]);
    expect(dir.json('machine.json')['profileEtag']).toBe('"etag-0002"');
  });

  test("applies the change to the account's newer document, not to the stale local copy", async ({
    dir,
  }) => {
    const account = fakeAccount();
    connected(dir, account);
    const newer = account.store(addWorld(account.stored?.profile ?? {}));
    const run = await install(account, HELLO);
    expect(run.lines).toContain(WORLD_OK);
    expect(account.requests[1]?.headers['if-match']).toBe(newer);
    expect(dir.json('profile.json')['extensions']).toEqual({ [WORLD]: '^1', [HELLO]: '^1.0.0' });
  });

  test('a 412 replays the install once on the newer document: installs again, loads, pushes once more', async ({
    dir,
  }) => {
    const account = fakeAccount();
    connected(dir, account);
    account.conflicts.push(addWorld);
    const run = await install(account, HELLO);
    expect(run.error).toBeNull();
    expect(profileCalls(account)).toEqual(['GET 200', 'PUT 412', 'PUT 200']);
    expect(run.lines).toContain(
      'profile    changed in your account meanwhile, replaying this change on it'
    );
    expect(run.lines).toContain(WORLD_OK);
    expect(account.stored?.profile['extensions']).toEqual({ [WORLD]: '^1', [HELLO]: '^1.0.0' });
  });

  test('a second 412 fails showing both documents and keeps the etag it had', async ({ dir }) => {
    const account = fakeAccount();
    const etag = connected(dir, account);
    account.conflicts.push(addWorld, addWorld);
    const run = await install(account, HELLO);
    expect(profileCalls(account)).toEqual(['GET 200', 'PUT 412', 'PUT 412']);
    expect(run.error).toMatch(/^not pushed: the profile in your account changed again/);
    expect(run.error).toContain('yours:');
    expect(run.error).toContain('in your account (etag "etag-0003")');
    expect(dir.json('machine.json')['profileEtag']).toBe(etag);
  });

  test('with the account unavailable fails before anything changes', async ({ dir }) => {
    const account = fakeAccount();
    connected(dir, account);
    account.fail('profile', 503);
    const before = dir.file('profile.json');
    expect((await install(account, HELLO)).error).toBe(
      'cloud profile unavailable (503 INTERNAL); nothing changed'
    );
    expect(dir.file('profile.json')).toBe(before);
    expect(dir.exists('extensions')).toBe(false);
  });

  test('a push the account refuses after the tree loaded fails: installed here, not pushed', async ({
    dir,
  }) => {
    const account = fakeAccount();
    connected(dir, account);
    account.fail('profile', 503, 'PUT');
    const run = await install(account, HELLO);
    expect(run.lines).toContain(HELLO_OK);
    expect(run.error).toBe(
      'not pushed to your account (503 INTERNAL); installed here only, run the command again to push it'
    );
  });

  test('pushes nothing when an extension did not load', async ({ dir }) => {
    const account = fakeAccount();
    connected(dir, account);
    expect((await install(account, pkg('throws'))).error).toBe(
      '1 extension failed to load: throws'
    );
    expect(profileCalls(account)).toEqual(['GET 200']);
  });

  test("--off pushes this machine's off list", async ({ dir }) => {
    const account = fakeAccount();
    connected(dir, account);
    expect((await install(account, pkg('secret'), { off: true })).error).toBeNull();
    expect(account.stored?.profile['machines']).toEqual({
      [MACHINE_ID]: { off: [pkg('secret')], config: {} },
    });
  });

  test('signed out, or signed in to another account, fails and changes nothing', async ({
    dir,
  }) => {
    connected(dir, fakeAccount());
    expect((await install(null, HELLO)).error).toBe(
      'not signed in - run: agentage setup (this machine syncs its profile with your account)'
    );
    const other = fakeAccount('user_2');
    expect((await install(other, HELLO)).error).toMatch(
      /^this machine is connected to account user_1/
    );
    expect(other.requests).toEqual([]);
    expect(dir.exists('extensions')).toBe(false);
  });

  test('a machine not connected to an account, and a dev extension, never call it', async ({
    dir,
  }) => {
    const account = fakeAccount();
    dir.machine({}, { profileSource: 'file' });
    expect((await install(account, HELLO)).error).toBeNull();
    dir.machine({}, { profileSource: 'cloud', accountId: 'user_1', profileEtag: '"etag-0001"' });
    expect((await install(account, fixture('world'))).error).toBeNull();
    expect(account.requests).toEqual([]);
  });
});

describe('agentage extension remove on a machine connected to an account', () => {
  test('pushes the profile without the extension', async ({ dir }) => {
    const account = fakeAccount();
    connected(dir, account, { hello: '^1.0.0' });
    dir.tree('hello');
    const run = await remove(account, 'hello');
    expect(run.error).toBeNull();
    expect(profileCalls(account)).toEqual(['GET 200', 'PUT 200']);
    expect(account.stored?.profile['extensions']).toEqual({});
    expect(run.lines.at(-1)).toBe('profile    pushed to your account (etag "etag-0002")');
  });

  test('with the account unavailable fails before anything is removed', async ({ dir }) => {
    const account = fakeAccount();
    connected(dir, account, { hello: '^1.0.0' });
    dir.tree('hello');
    dir.write('state/hello.json', {});
    account.fail('profile', 'timeout');
    expect((await remove(account, 'hello')).error).toBe(
      'cloud profile unavailable (timed out); nothing changed'
    );
    expect(dir.exists('state/hello.json')).toBe(true);
  });
});
