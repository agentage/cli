import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AuthState } from '../../lib/fs/config.js';
import { runAuthToken } from './token.js';

const NOW = 1_800_000_000_000;

const session = (expiresAt?: number, kind?: 'pat'): AuthState => ({
  siteFqdn: 'agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'at_old', refreshToken: 'rt_1', expiresAt },
  ...(kind && { kind }),
});

const deps = (auth: AuthState | null) => ({
  read: () => auth,
  now: () => NOW,
  refresh: vi.fn(async (a: AuthState) => {
    a.tokens = { accessToken: 'at_new', refreshToken: 'rt_2', expiresAt: NOW + 3_600_000 };
  }),
});

afterEach(() => vi.restoreAllMocks());

describe('agentage auth token', () => {
  it('prints a token that lives over 60 s as is, with no refresh', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const d = deps(session(NOW + 61_000));
    expect(await runAuthToken(d)).toEqual({
      accessToken: 'at_old',
      expiresAt: new Date(NOW + 61_000).toISOString(),
    });
    expect(d.refresh).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('at_old');
  });

  it.each([
    ['ends within 60 s', NOW + 59_000],
    ['has ended', NOW - 1],
    ['has no known end', undefined],
  ])('refreshes first a token that %s', async (_n, expiresAt) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const d = deps(session(expiresAt));
    expect((await runAuthToken(d)).accessToken).toBe('at_new');
    expect(d.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ['signed out', null],
    ['a PAT only', session(NOW + 3_600_000, 'pat')],
  ])('%s: auth_required, nothing printed', async (_n, auth) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runAuthToken(deps(auth))).rejects.toThrow('not signed in - run: agentage setup');
    expect(log).not.toHaveBeenCalled();
  });
});
