import { afterEach, describe, expect, it, vi } from 'vitest';
import { signedInAccount } from './account.js';

vi.mock('../../lib/auth/credentials.js', () => ({ resolveAuth: () => ({ accessToken: 't' }) }));
vi.mock('../../lib/auth/env-match.js', () => ({ detectEnvMismatch: () => null }));
const authed = vi.fn(async () => new Response(null, { status: 204 }));
vi.mock('../../lib/auth/api.js', () => ({
  authedFetch: (...a: unknown[]) => authed(...(a as [])),
}));
vi.mock('../../lib/net/discovery.js', () => ({
  discoverTarget: async () => ({
    links: { site: 'https://next.test', api: '', auth: 'https://auth.test' },
    platform: {
      url: 'https://platform.next.test',
      machines: 'https://platform.next.test/api/v1/machines',
    },
  }),
}));

describe('signedInAccount', () => {
  afterEach(() => authed.mockClear());

  it('sends machines calls to <platform>/api/v1/machines and profile calls to the api origin', async () => {
    const account = await signedInAccount();
    await account?.machines('/m_0000beef/seen', { method: 'POST' });
    await account?.fetch('/v1/profile');
    const urls = authed.mock.calls.map((c) => (c as unknown as unknown[])[2]);
    expect(urls).toEqual([
      'https://platform.next.test/api/v1/machines/m_0000beef/seen',
      'https://api.agentage.io/v1/profile',
    ]);
  });
});
