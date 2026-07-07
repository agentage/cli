import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthState } from './config.js';
import { fetchJsonUnref } from './http.js';
import { gatherStatus } from './status-info.js';

vi.mock('./http.js', () => ({ fetchJsonUnref: vi.fn() }));
const httpMock = vi.mocked(fetchJsonUnref);

const auth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'at' },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// health + the npm-registry update check go through fetchJsonUnref (node:https); introspection
// (get-session) still uses global fetch via authedGet.
const stubHttp = (health: 'reachable' | 'unreachable'): void => {
  httpMock.mockImplementation((url: string) => {
    if (url.endsWith('/latest'))
      return Promise.resolve({ ok: true, status: 200, json: { version: '0.0.0' } });
    if (url.endsWith('/health'))
      return Promise.resolve(health === 'reachable' ? { ok: true, status: 200, json: {} } : null);
    return Promise.resolve(null);
  });
};

beforeEach(() => stubHttp('reachable'));

afterEach(() => {
  httpMock.mockReset();
  vi.unstubAllGlobals();
});

describe('gatherStatus', () => {
  it('reports a degraded status when not signed in', async () => {
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.env).toBe('development');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('agentage setup');
    expect(report.endpoint.reachable).toBe(true);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('marks the endpoint unreachable on network failure', async () => {
    stubHttp('unreachable');
    const report = await gatherStatus(null, 'agentage.io');
    expect(report.endpoint.reachable).toBe(false);
  });

  it('reports signed-in with token expiry when introspection succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: '2026-06-12T20:00:00Z' })
      )
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth).toEqual({ signedIn: true, tokenExpiresAt: '2026-06-12T20:00:00Z' });
  });

  it('treats a 200 + null session as signed-out instead of crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, null))
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('agentage setup');
    expect(report.auth.note).not.toContain('Cannot read properties');
  });

  it('downgrades to signed-out with a hint when the token is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, {}))
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('session expired');
  });

  it('reports verification failures without claiming signed-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, {}))
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('could not verify session');
  });
});
