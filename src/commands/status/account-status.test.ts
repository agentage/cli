import { describe, expect } from 'vitest';
import { connected, fakeAccount, type FakeAccount } from '../../test/account.js';
import { test } from '../../test/config-dir.js';
import { summaryLines } from '../extension/row-lines.js';
import { gatherWithAccount } from './account-status.js';

const profileLine = async (account: FakeAccount | null): Promise<string | undefined> =>
  summaryLines((await gatherWithAccount(account?.account() ?? null)).status).find((line) =>
    line.startsWith('profile')
  );

describe('agentage status and the account', () => {
  test("shows the local etag; once another machine pushed, the account's version and etag too", async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = connected(dir, account);
    expect(await profileLine(account)).toBe(`profile    version 1 (source: cloud, etag ${etag})`);
    expect(account.requests.find((r) => r.path === '/v1/profile')).toMatchObject({
      headers: { 'if-none-match': etag },
      timeoutMs: 2000,
    });
    const newer = account.store({ version: 1, extensions: {} });
    expect(await profileLine(account)).toBe(
      `profile    version 1 (source: cloud, etag ${etag}); account: version 1, etag ${newer} - run agentage setup`
    );
  });

  test('the account unreachable, or signed out: the local copy only, and nothing fails', async ({
    dir,
  }) => {
    const account = fakeAccount();
    const etag = connected(dir, account);
    account.store({ version: 1 });
    account.fail('profile', 'network');
    expect(await profileLine(account)).toBe(`profile    version 1 (source: cloud, etag ${etag})`);
    expect(await profileLine(null)).toBe(`profile    version 1 (source: cloud, etag ${etag})`);
  });

  test('machine.registered: false before setup registered it, true after, null when unreachable or signed out', async ({
    dir,
  }) => {
    dir.machine();
    const account = fakeAccount();
    const registered = async (a: FakeAccount | null) =>
      (await gatherWithAccount(a?.account() ?? null)).status.machine.registered;
    expect(await registered(account)).toBe(false);
    account.machines.set('m_0000beef', { name: 'box' });
    expect(await registered(account)).toBe(true);
    expect(await registered(null)).toBeNull();
    account.fail('machines', 503);
    expect(await registered(account)).toBeNull();
  });

  test('a profile from a file or no account asks the account nothing about the profile', async ({
    dir,
  }) => {
    dir.profile({ extensions: {} });
    dir.machine({}, { profileSource: 'file' });
    const account = fakeAccount();
    expect(await profileLine(account)).toBe('profile    version 1 (source: file)');
    expect(account.requests.map((r) => r.path)).toEqual(['/v1/machines/m_0000beef/seen']);
  });
});
