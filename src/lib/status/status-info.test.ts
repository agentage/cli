import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthState } from '../fs/config.js';
import { fetchJsonUnref } from '../net/http.js';
import { gatherStatus } from './status-info.js';

vi.mock('../net/http.js', () => ({ fetchJsonUnref: vi.fn() }));
const httpMock = vi.mocked(fetchJsonUnref);

const auth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'at', refreshToken: 'rt' },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// health, the site-root reachability probe, and the npm-registry update check all go through
// fetchJsonUnref (node:https); introspection (get-session) still uses global fetch via authedGet.
// The site probe hits the bare origin (no /health, no /latest) and counts any non-null response.
const stubHttp = (health: 'reachable' | 'unreachable'): void => {
  httpMock.mockImplementation((url: string) => {
    if (url.endsWith('/latest'))
      return Promise.resolve({ ok: true, status: 200, json: { version: '0.0.0' } });
    if (url.endsWith('/health'))
      return Promise.resolve(health === 'reachable' ? { ok: true, status: 200, json: {} } : null);
    // Site root: a 4xx still proves the host is up, so mirror it as a non-null response.
    return Promise.resolve(health === 'reachable' ? { ok: false, status: 404, json: null } : null);
  });
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentage-status-'));
  process.env['AGENTAGE_CONFIG_DIR'] = dir;
  stubHttp('reachable');
});

afterEach(() => {
  delete process.env['AGENTAGE_CONFIG_DIR'];
  rmSync(dir, { recursive: true, force: true });
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
    expect(report.target).toEqual({ fqdn: 'dev.agentage.io', env: 'development', reachable: true });
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('marks the endpoint and target unreachable on network failure', async () => {
    stubHttp('unreachable');
    const report = await gatherStatus(null, 'agentage.io');
    expect(report.endpoint.reachable).toBe(false);
    expect(report.target.reachable).toBe(false);
  });

  it('treats a non-2xx site response as a reachable target', async () => {
    // A 4xx from the site root still proves the host is up: reachability, not app health.
    httpMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/health') || url.endsWith('/latest')
          ? { ok: true, status: 200, json: {} }
          : { ok: false, status: 403, json: null }
      )
    );
    const report = await gatherStatus(null, 'agentage.io');
    expect(report.target.reachable).toBe(true);
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

  it('flags pat auth when the credential is a personal access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: 'x' }))
    );
    const patAuth: AuthState = { ...auth, kind: 'pat', tokens: { accessToken: 'aga_x' } };
    const report = await gatherStatus(patAuth, 'dev.agentage.io');
    expect(report.auth).toEqual({ signedIn: true, tokenExpiresAt: 'x', pat: true });
  });

  it('refreshes on a 200 + null session and reports signed-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('/token'))
          return Promise.resolve(jsonResponse(200, { access_token: 'new', expires_in: 60 }));
        const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
        return Promise.resolve(
          bearer === 'Bearer new'
            ? jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: 'x' })
            : jsonResponse(200, null)
        );
      })
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(true);
    expect(report.auth.note).toBeUndefined();
  });

  it('reports session expired when a 200 + null survives a terminal (invalid_grant) refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/token')
            ? jsonResponse(400, { error: 'invalid_grant' })
            : jsonResponse(200, null)
        )
      )
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toBe('session expired - run: agentage setup');
  });

  it('reports session expired when the token is authoritatively rejected (401)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/token')
            ? jsonResponse(400, { error: 'invalid_grant' })
            : jsonResponse(401, {})
        )
      )
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('session expired');
  });

  it('reports signed-in (never expired) on a 5xx blip while holding an unexpired token', async () => {
    const future = Date.now() + 3_600_000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, {}))
    );
    const report = await gatherStatus(
      { ...auth, tokens: { ...auth.tokens, expiresAt: future } },
      'dev.agentage.io'
    );
    // An unexpired token + a get-session blip stays a clean signed-in (exit 0), never "expired".
    expect(report.auth.signedIn).toBe(true);
    expect(report.auth.note ?? '').not.toContain('expired');
  });

  it('does not report expired when a refresh blips transiently on an expired token', async () => {
    // Stored token past expiry -> proactive refresh returns 429 (transient), never invalid_grant.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/token') ? jsonResponse(429, {}) : jsonResponse(200, null)
        )
      )
    );
    const report = await gatherStatus(
      { ...auth, tokens: { ...auth.tokens, expiresAt: Date.now() - 1000 } },
      'dev.agentage.io'
    );
    expect(report.auth.transient).toBe(true);
    expect(report.auth.note).not.toContain('expired');
  });

  it('reports an env mismatch (dev credential, prod target) instead of session expired', async () => {
    // No fetch stub for get-session: a mismatch must never introspect cross-environment.
    const report = await gatherStatus(auth, 'agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.mismatch).toEqual({
      credentialFqdn: 'dev.agentage.io',
      credentialEnv: 'development',
      targetFqdn: 'agentage.io',
      targetEnv: 'production',
    });
    expect(report.auth.note).toContain('dev.agentage.io');
    expect(report.auth.note).toContain('agentage.io');
    expect(report.auth.note).not.toContain('session expired');
  });

  it('reports an env mismatch in the reverse direction (prod credential, dev target)', async () => {
    const prodAuth = { ...auth, siteFqdn: 'agentage.io' };
    const report = await gatherStatus(prodAuth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.mismatch?.credentialEnv).toBe('production');
    expect(report.auth.mismatch?.targetEnv).toBe('development');
    expect(report.auth.note).not.toContain('session expired');
  });
});
