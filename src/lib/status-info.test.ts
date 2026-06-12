import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AuthState } from './config.js';
import { gatherStatus } from './status-info.js';

const auth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'at' },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const stubFetch = (routes: Record<string, () => Response>): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      for (const [suffix, response] of Object.entries(routes)) {
        if (url.endsWith(suffix)) return Promise.resolve(response());
      }
      return Promise.reject(new Error(`unmatched url: ${url}`));
    })
  );
};

afterEach(() => vi.unstubAllGlobals());

describe('gatherStatus', () => {
  it('reports a degraded status when not signed in', async () => {
    stubFetch({ '/health': () => jsonResponse(200, { ok: true }) });
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.env).toBe('development');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('agentage setup');
    expect(report.endpoint.reachable).toBe(true);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('marks the endpoint unreachable on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    const report = await gatherStatus(null, 'agentage.io');
    expect(report.endpoint.reachable).toBe(false);
  });

  it('reports signed-in with token expiry when introspection succeeds', async () => {
    stubFetch({
      '/health': () => jsonResponse(200, {}),
      '/get-session': () =>
        jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: '2026-06-12T20:00:00Z' }),
    });
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth).toEqual({ signedIn: true, tokenExpiresAt: '2026-06-12T20:00:00Z' });
  });

  it('downgrades to signed-out with a hint when the token is rejected', async () => {
    stubFetch({
      '/health': () => jsonResponse(200, {}),
      '/get-session': () => jsonResponse(401, {}),
    });
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('session expired');
  });

  it('reports verification failures without claiming signed-in', async () => {
    stubFetch({
      '/health': () => jsonResponse(200, {}),
      '/get-session': () => jsonResponse(500, {}),
    });
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('could not verify session');
  });
});
