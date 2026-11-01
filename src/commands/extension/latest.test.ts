import { describe, expect } from 'vitest';
import {
  connected,
  editDeps,
  fakeAccount,
  noAccount,
  profileCalls,
  type FakeAccount,
} from '../../test/account.js';
import { output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { npmFromFixtures, npmPublishing, type Publishes } from '../../test/npm-fixtures.js';
import { install } from '../../core/installer/installer.js';
import { runSetupLatest } from './latest.js';

const HELLO = pkg('hello');
const HELLO_OK = 'hello  ok         @agentage/fixture-hello 1.0.1 (wants ^1.0.0)  commands: hello';
const UPDATE = '~ update @agentage/fixture-hello 1.0.0 -> 1.0.1';
const NEWER: Publishes = { [HELLO]: { '1.0.1': {} } };

// hello 1.0.0 installed from a profile file, the way setup --profile leaves a machine.
const installedFromFile = async (dir: ConfigDir): Promise<string> => {
  dir.machine({}, { profileSource: 'file' });
  dir.profile({ extensions: { hello: '^1.0.0' } });
  return (await install({ extensions: { [HELLO]: '^1.0.0' }, registries: {} }, npmFromFixtures))
    .tree;
};

const latest = (more: Publishes, account: FakeAccount | null = null) =>
  output(() =>
    runSetupLatest({ ...(account ? editDeps(account) : noAccount), npm: npmPublishing(more) })
  );

const lockedHello = (lock: unknown): unknown =>
  (lock as { packages: Record<string, { version: string }> }).packages[`node_modules/${HELLO}`]
    ?.version;

describe('agentage setup --latest', () => {
  test('prints the version diff and a summary, loads the new tree, prints its rows; only that tree is left', async ({
    dir,
  }) => {
    const old = await installedFromFile(dir);
    const run = await latest(NEWER);
    expect(run.error).toBeNull();
    const tree = dir.file('extensions/current');
    expect(tree).not.toBe(old);
    expect(run.lines).toEqual([UPDATE, `latest: 1 updated, 0 unchanged in tree ${tree}`, HELLO_OK]);
    expect(dir.list('extensions/trees')).toEqual([tree]);
    expect(lockedHello(dir.json('extensions/package-lock.json'))).toBe('1.0.1');
    expect(dir.json('state/hello.json')).toMatchObject({ state: 'ok', version: '1.0.1' });
  });

  test('with nothing newer prints "latest: nothing to update", loads nothing and builds no tree', async ({
    dir,
  }) => {
    const old = await installedFromFile(dir);
    const run = await latest({});
    expect(run).toMatchObject({ lines: ['latest: nothing to update'], error: null });
    expect(dir.list('extensions/trees')).toEqual([old]);
    expect(dir.exists('state')).toBe(false);
  });

  test('keeps an extension whose newest allowed version needs another extension API, saying so', async ({
    dir,
  }) => {
    await installedFromFile(dir);
    const run = await latest({ [HELLO]: { '1.1.0': { engines: { agentage: '^2' } } } });
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'kept       @agentage/fixture-hello 1.0.0 (1.1.0 needs extension API ^2)',
      'latest: nothing to update',
    ]);
  });

  test('a profile changed by hand since the last install: the diff adds and removes too', async ({
    dir,
  }) => {
    await installedFromFile(dir);
    dir.profile({ extensions: { secret: '^1' } });
    const run = await latest({});
    expect(run.lines.slice(0, 2)).toEqual([
      '- remove @agentage/fixture-hello 1.0.0',
      '+ add @agentage/fixture-secret 1.0.0',
    ]);
    expect(run.lines[2]).toMatch(/^latest: 2 updated, 0 unchanged in tree /);
  });

  test('a new version that does not load clean keeps the old tree current and fails naming it', async ({
    dir,
  }) => {
    const old = await installedFromFile(dir);
    const run = await latest({ [HELLO]: { '1.0.1': { main: 'missing.js' } } });
    expect(run.lines).toContainEqual(expect.stringMatching(/^hello {2}invalid .* 1\.0\.1 /));
    expect(run.error).toBe('not updated: hello invalid; extensions/current is unchanged');
    expect(dir.file('extensions/current')).toBe(old);
    expect(dir.list('extensions/trees')).toEqual([old]);
  });
});

describe("agentage setup --latest on a copy of your account's profile", () => {
  const fromAccount = async (dir: ConfigDir, account: FakeAccount): Promise<string> => {
    const etag = connected(dir, account, { hello: '^1.0.0' });
    await install({ extensions: { [HELLO]: '^1.0.0' }, registries: {} }, npmFromFixtures);
    return etag;
  };

  test('pushes the profile with the new lock, If-Match its etag, once the new tree loaded', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = await fromAccount(dir, account);
    const run = await latest(NEWER, account);
    expect(run.error).toBeNull();
    expect(profileCalls(account)).toEqual(['GET 200', 'PUT 200']);
    expect(account.requests.at(-1)?.headers['if-match']).toBe(etag);
    expect(lockedHello(account.stored?.lock)).toBe('1.0.1');
    expect(account.stored?.npmMajor).toBe(10);
    const stored = account.stored?.etag;
    expect(run.lines.at(-1)).toBe(`profile    pushed to your account (etag ${stored})`);
    expect(dir.json('machine.json')['profileEtag']).toBe(stored);
  });

  test('with nothing newer, or a new tree that does not load, pushes nothing', async ({ dir }) => {
    const account = fakeAccount();
    await fromAccount(dir, account);
    expect((await latest({}, account)).lines).toEqual(['latest: nothing to update']);
    const broken = await latest({ [HELLO]: { '1.0.1': { main: 'missing.js' } } }, account);
    expect(broken.error).toMatch(/^not updated: hello invalid/);
    expect(profileCalls(account)).toEqual(['GET 200', 'GET 200']);
  });
});
