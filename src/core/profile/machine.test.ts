import { statSync } from 'node:fs';
import { hostname } from 'node:os';
import { describe, expect } from 'vitest';
import { MACHINE_ID, test } from '../../test/config-dir.js';
import {
  accountMismatch,
  forgetAccount,
  loadMachine,
  setAccount,
  setCloud,
  setDev,
  setProfileSource,
} from './machine.js';

const COMPLETE = {
  id: 'm_1a2b3c4d',
  name: 'box',
  dev: {},
  profileSource: 'file',
  accountId: null,
  profileEtag: null,
};

describe('machine.json', () => {
  test('the first command creates it: an m_ id, this host name, mode 0600', async ({ dir }) => {
    const machine = await loadMachine();
    expect(machine).toEqual({
      id: expect.stringMatching(/^m_[0-9a-f]{8}$/),
      name: hostname(),
      dev: {},
      profileSource: 'default',
      accountId: null,
      profileEtag: null,
    });
    expect(dir.json('machine.json')).toEqual(machine);
    expect(statSync(dir.at('machine.json')).mode & 0o777).toBe(0o600);
  });

  test('two first runs at once agree on one id', async () => {
    const [a, b] = await Promise.all([loadMachine(), loadMachine()]);
    expect(a.id).toBe(b.id);
  });

  test('once complete it is read as is and never rewritten', async ({ dir }) => {
    dir.write('machine.json', JSON.stringify({ ...COMPLETE, dev: { x: '/src/x' } }));
    const before = dir.file('machine.json');
    expect(await loadMachine()).toEqual({ ...COMPLETE, dev: { x: '/src/x' } });
    expect(dir.file('machine.json')).toBe(before);
  });

  test.for([
    ['a uuid id from an older CLI', { ...COMPLETE, id: '260d7044-b229-4afb-bbf3-40af745c3926' }],
    ['no profileSource', { id: 'm_1a2b3c4d', name: 'box', dev: {} }],
    [
      'no accountId and no profileEtag, as 0.39 wrote it',
      { id: 'm_1a2b3c4d', name: 'box', dev: {}, profileSource: 'file' },
    ],
    ['an empty accountId', { ...COMPLETE, accountId: '' }],
    ['a profileEtag that is not a string', { ...COMPLETE, profileEtag: 1 }],
    ['an unknown key', { ...COMPLETE, extra: true }],
    ['an empty name', { ...COMPLETE, name: '' }],
    ['a dev path that is not a string', { ...COMPLETE, dev: { x: 1 } }],
    ['an unknown profileSource', { ...COMPLETE, profileSource: 'remote' }],
    ['a body that is not an object', [1]],
  ] as const)('with %s is replaced with a fresh one, not migrated', async ([, raw], { dir }) => {
    dir.write('machine.json', raw);
    const machine = await loadMachine();
    expect(machine).toMatchObject({ name: hostname(), dev: {}, profileSource: 'default' });
    expect(machine.id).not.toBe(COMPLETE.id);
    expect(dir.json('machine.json')).toEqual(machine);
  });

  test('setup records where the profile came from, keeping the id', async ({ dir }) => {
    dir.machine();
    expect(await setProfileSource('file')).toMatchObject({ id: MACHINE_ID, profileSource: 'file' });
    expect(dir.json('machine.json')).toMatchObject({ id: MACHINE_ID, profileSource: 'file' });
  });

  test('recording the same source again leaves it untouched', async ({ dir }) => {
    dir.write('machine.json', JSON.stringify(COMPLETE));
    await setProfileSource('file');
    expect(dir.file('machine.json')).toBe(JSON.stringify(COMPLETE));
  });

  test('recording the source on a new machine creates it first', async ({ dir }) => {
    const machine = await setProfileSource('file');
    expect(machine.id).toMatch(/^m_[0-9a-f]{8}$/);
    expect(dir.json('machine.json')).toEqual(machine);
  });

  test('a dev path is added and removed by package name, keeping the others and the id', async ({
    dir,
  }) => {
    dir.write('machine.json', JSON.stringify(COMPLETE));
    await setDev('@x/a', '/src/a');
    await setDev('@x/b', '/src/b');
    await setDev('@x/a', null);
    expect(dir.json('machine.json')).toEqual({ ...COMPLETE, dev: { '@x/b': '/src/b' } });
  });

  test('a pull or a push records the etag and the cloud source; setup records the account once', async ({
    dir,
  }) => {
    dir.machine();
    await setAccount('user_1');
    await setCloud('"etag-0001"');
    expect(dir.json('machine.json')).toMatchObject({
      id: MACHINE_ID,
      profileSource: 'cloud',
      profileEtag: '"etag-0001"',
      accountId: 'user_1',
    });
  });

  test("setup --disconnect forgets the account and the etag; a cloud copy becomes this machine's own", async ({
    dir,
  }) => {
    dir.machine();
    await setAccount('user_1');
    await setCloud('"etag-0001"');
    await forgetAccount();
    expect(dir.json('machine.json')).toMatchObject({
      profileSource: 'default',
      profileEtag: null,
      accountId: null,
    });
    await setProfileSource('file');
    await forgetAccount();
    expect(dir.json('machine.json')['profileSource']).toBe('file');
  });

  test('a machine connected to one account refuses another, naming both and the fix', async () => {
    const machine = { ...(await loadMachine()), accountId: 'user_1' };
    expect(accountMismatch(machine, 'user_1')).toBeNull();
    expect(accountMismatch(machine, null)).toBeNull();
    expect(accountMismatch({ ...machine, accountId: null }, 'user_2')).toBeNull();
    expect(accountMismatch(machine, 'user_2')?.message).toBe(
      'this machine is connected to account user_1, but you are signed in as user_2; ' +
        'run agentage setup --disconnect, then agentage setup'
    );
  });
});
