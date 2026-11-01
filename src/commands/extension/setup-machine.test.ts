import { describe, expect } from 'vitest';
import { editDeps, fakeAccount, type FakeAccount } from '../../test/account.js';
import { MACHINE_ID, output, test } from '../../test/config-dir.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup } from './setup.js';

// Signed in already; the stand-in for sign-out says it ran.
const setup = (account: FakeAccount, opts: SetupOptions = {}) =>
  output(() =>
    runExtensionSetup(opts, {
      ensureSignedIn: async () => 'already',
      signOut: async () => console.log('(signed out)'),
      printStatus: async () => undefined,
      ...editDeps(account),
    })
  );

describe('agentage setup and this machine in the account', () => {
  test('registers the machine and marks it seen; --disconnect marks it disconnected, signs out and forgets the account', async ({
    dir,
  }) => {
    const account = fakeAccount();
    await setup(account);
    const path = `/v1/machines/${String(dir.json('machine.json')['id'])}`;
    const off = await setup(account, { disconnect: true });
    expect(off.lines).toEqual(['(signed out)']);
    expect(account.requests.filter((r) => r.path.startsWith('/v1/machines'))).toMatchObject([
      { method: 'PUT', path, body: { state: 'connected' } },
      { method: 'POST', path: `${path}/seen` },
      { method: 'PATCH', path, body: { state: 'disconnected' } },
    ]);
    expect(dir.json('machine.json')).toMatchObject({
      accountId: null,
      profileEtag: null,
      profileSource: 'default',
    });
  });

  test('--disconnect without machine.json signs out and creates none', async ({ dir }) => {
    const account = fakeAccount();
    expect((await setup(account, { disconnect: true })).lines).toEqual(['(signed out)']);
    expect(account.requests).toEqual([]);
    expect(dir.exists('machine.json')).toBe(false);
  });

  test('the machines routes failing never fail setup, and print nothing', async ({ dir }) => {
    dir.machine();
    const account = fakeAccount();
    account.fail('machines', 503);
    const run = await setup(account);
    expect(run.error).toBeNull();
    expect(run.stderr).toBe('');
    expect(account.machines.size).toBe(0);
    expect(account.requests.filter((r) => r.path === `/v1/machines/${MACHINE_ID}`)).toHaveLength(1);
  });
});
