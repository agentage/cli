import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  authedFetch,
  authedJson,
  AuthRequiredError,
  introspectToken,
  refreshOrThrow,
  TransientAuthError,
} from './api.js';
import { patAuthState } from './credentials.js';
import { deleteAuth, readAuth, saveAuth, type AuthState } from '../fs/config.js';
import { links } from '../net/origins.js';

// cliFetch pins the global fetch at load, so tests swap the module's export instead.
const net = vi.hoisted(() => ({
  fetch: (..._args: unknown[]): Promise<Response> => Promise.reject(),
}));
vi.mock('../net/fetch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cliFetch: (url: string, init?: RequestInit) => net.fetch(url, init),
}));
type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;
const useFetch = (fn: FetchStub): void => {
  net.fetch = fn as typeof net.fetch;
};

const target = links('dev.agentage.io');

const makeAuth = (overrides: Partial<AuthState['tokens']> = {}): AuthState => ({
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'old-token', refreshToken: 'rt', ...overrides },
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('authedJson', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('sends the bearer token and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    useFetch(fetchMock);
    const result = await authedJson<{ ok: boolean }>(makeAuth(), target, 'https://x.example/me');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://x.example/me', {
      headers: { authorization: 'Bearer old-token' },
    });
  });

  it('refreshes once on 401, persists the new tokens, and retries', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/token'))
        return Promise.resolve(jsonResponse(200, { access_token: 'new-token', expires_in: 60 }));
      const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
      return Promise.resolve(
        bearer === 'Bearer new-token' ? jsonResponse(200, { ok: true }) : jsonResponse(401, {})
      );
    });
    useFetch(fetchMock);
    const auth = makeAuth();
    saveAuth(auth); // a real refresh always runs against a session already on disk
    const result = await authedJson<{ ok: boolean }>(auth, target, 'https://x.example/me');
    expect(result.ok).toBe(true);
    expect(auth.tokens.accessToken).toBe('new-token');
    expect(readAuth()?.tokens.accessToken).toBe('new-token');
  });

  it('throws AuthRequiredError when 401 and no refresh token', async () => {
    useFetch(vi.fn().mockResolvedValue(jsonResponse(401, {})));
    await expect(
      authedJson(makeAuth({ refreshToken: undefined }), target, 'https://x.example/me')
    ).rejects.toThrow(AuthRequiredError);
  });

  it('throws AuthRequiredError when the refresh itself fails', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.includes('/token') ? jsonResponse(400, {}) : jsonResponse(401, {}))
    );
    useFetch(fetchMock);
    await expect(authedJson(makeAuth(), target, 'https://x.example/me')).rejects.toThrow(
      AuthRequiredError
    );
  });

  it('surfaces non-auth errors with the status code', async () => {
    useFetch(vi.fn().mockResolvedValue(jsonResponse(500, {})));
    await expect(authedJson(makeAuth(), target, 'https://x.example/x')).rejects.toThrow('500');
  });

  it('refuses to follow a redirect and reports its status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(302, {}));
    useFetch(fetchMock);
    await expect(authedJson(makeAuth(), target, 'https://x.example/me')).rejects.toThrow(
      'GET https://x.example/me refused redirect (302)'
    );
  });
});

describe('introspectToken', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('calls the introspection endpoint and maps the session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: '2026-06-12T20:00:00Z' })
      );
    useFetch(fetchMock);
    const session = await introspectToken(makeAuth(), target);
    expect(session).toEqual({ userId: 'u1', expiresAt: '2026-06-12T20:00:00Z' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://auth.dev.agentage.io/api/auth/mcp/get-session'
    );
  });

  it('refreshes once on a 200 + null session, then re-introspects as signed in', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/token'))
        return Promise.resolve(jsonResponse(200, { access_token: 'new-token', expires_in: 60 }));
      const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
      return Promise.resolve(
        bearer === 'Bearer new-token'
          ? jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: 'x' })
          : jsonResponse(200, null)
      );
    });
    useFetch(fetchMock);
    const auth = makeAuth();
    saveAuth(auth);
    const session = await introspectToken(auth, target);
    expect(session.userId).toBe('u1');
    expect(auth.tokens.accessToken).toBe('new-token');
    expect(readAuth()?.tokens.accessToken).toBe('new-token');
  });

  it('throws AuthRequiredError when a 200 + null survives a terminal refresh (invalid_grant)', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/token')
          ? jsonResponse(400, { error: 'invalid_grant' })
          : jsonResponse(200, null)
      )
    );
    useFetch(fetchMock);
    await expect(introspectToken(makeAuth(), target)).rejects.toThrow(AuthRequiredError);
  });

  it('throws TransientAuthError (not AuthRequired) when a 200 + null refresh blips 429', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/token') ? jsonResponse(429, {}) : jsonResponse(200, null)
      )
    );
    useFetch(fetchMock);
    await expect(introspectToken(makeAuth(), target)).rejects.toThrow(TransientAuthError);
  });

  it('reports the unexpired stored token as signed-in when get-session blips 5xx', async () => {
    const expiresAt = Date.now() + 3_600_000;
    const fetchMock = vi.fn(async () => jsonResponse(500, {}));
    useFetch(fetchMock);
    const auth = makeAuth({ expiresAt });
    const session = await introspectToken(auth, target);
    // Held an unexpired token: treat the 5xx as a blip, report the stored expiry, never throw.
    expect(session.expiresAt).toBe(new Date(expiresAt).toISOString());
  });

  it('throws TransientAuthError when an expired token cannot refresh (5xx)', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/token') ? jsonResponse(503, {}) : jsonResponse(200, {})
      )
    );
    useFetch(fetchMock);
    const auth = makeAuth({ expiresAt: Date.now() - 1000 });
    await expect(introspectToken(auth, target)).rejects.toThrow(TransientAuthError);
  });

  it('refreshes and re-introspects when the session reports an already-past expiry', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/token'))
        return Promise.resolve(jsonResponse(200, { access_token: 'refreshed', expires_in: 3600 }));
      const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
      return Promise.resolve(
        bearer === 'Bearer refreshed'
          ? jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: future })
          : jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: past })
      );
    });
    useFetch(fetchMock);
    const auth = makeAuth();
    const session = await introspectToken(auth, target);
    // The displayed expiry must be the post-refresh future value, never the stale past one.
    expect(session.expiresAt).toBe(future);
    expect(Date.parse(session.expiresAt as string)).toBeGreaterThan(Date.now());
  });

  it('refreshes proactively when the stored token is already past expiry', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/token'))
        return Promise.resolve(jsonResponse(200, { access_token: 'fresh', expires_in: 60 }));
      const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
      return Promise.resolve(
        bearer === 'Bearer fresh' ? jsonResponse(200, { userId: 'u2' }) : jsonResponse(200, null)
      );
    });
    useFetch(fetchMock);
    const auth = makeAuth({ expiresAt: Date.now() - 1000 });
    const session = await introspectToken(auth, target);
    expect(session.userId).toBe('u2');
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/token'));
    expect(tokenCalls).toHaveLength(1);
  });
});

// A PAT-backed credential must ride through the same authed request paths as an OAuth access token
// (it IS an oauthAccessToken row server-side) - but it carries no refresh token and must never
// attempt an OAuth refresh.
describe('PAT-backed AuthState', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  const pat = patAuthState('aga_test123', 'dev.agentage.io');

  it('sends the PAT as the Bearer on an authed GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    useFetch(fetchMock);
    await authedJson(pat, target, 'https://memory.dev.agentage.io/mcp/me');
    expect(fetchMock).toHaveBeenCalledWith('https://memory.dev.agentage.io/mcp/me', {
      headers: { authorization: 'Bearer aga_test123' },
    });
  });

  it('refuses to refresh a PAT (no OAuth refresh grant) with a dashboard-pointing message', async () => {
    const fetchMock = vi.fn();
    useFetch(fetchMock);
    await expect(refreshOrThrow(pat, target)).rejects.toThrow(AuthRequiredError);
    await expect(refreshOrThrow(pat, target)).rejects.toThrow(/personal access token/);
    // Never hits the token endpoint - a PAT cannot be refreshed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not attempt a refresh on a 401 (a PAT is terminal on 401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    useFetch(fetchMock);
    await expect(authedJson(pat, target, 'https://memory.dev.agentage.io/mcp/me')).rejects.toThrow(
      AuthRequiredError
    );
    // Exactly one call (the original) - no /token refresh attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Issue #236: a sign-out that lands while a token refresh is in flight must stay signed out. The
// refresh may still use its fresh tokens in memory for the request already on the wire, but the
// null re-read is the authoritative "session ended" - it is never folded back onto disk.
describe('refreshOrThrow vs a concurrent sign-out', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  const refreshOnce = (onTokenCall: () => Promise<void>): Mock<FetchStub> =>
    vi.fn(async (url: string) => {
      if (!String(url).includes('/token')) return jsonResponse(200, {});
      await onTokenCall(); // the sign-out lands while the refresh is on the wire
      return jsonResponse(200, { access_token: 'new-token', expires_in: 60 });
    });

  it('does not resurrect auth.json when deleteAuth lands during the refresh', async () => {
    const auth = makeAuth();
    saveAuth(auth);
    useFetch(refreshOnce(() => deleteAuth()));
    await refreshOrThrow(auth, target);
    expect(readAuth()).toBeNull(); // signed out stays signed out
    expect(auth.tokens.accessToken).toBe('new-token'); // in-flight request still retries
  });

  it('stays signed out across 50 sign-out/refresh races', async () => {
    for (let i = 0; i < 50; i++) {
      const auth = makeAuth();
      saveAuth(auth);
      let signOut: Promise<void> | undefined;
      useFetch(
        refreshOnce(() => {
          signOut = deleteAuth(); // raced, not awaited: either order must end signed out
          return Promise.resolve();
        })
      );
      await refreshOrThrow(auth, target);
      await signOut;
      expect(readAuth()).toBeNull();
    }
  });

  it('still persists the refreshed tokens when no sign-out races it', async () => {
    const auth = makeAuth();
    saveAuth(auth);
    useFetch(refreshOnce(() => Promise.resolve()));
    await refreshOrThrow(auth, target);
    expect(readAuth()?.tokens.accessToken).toBe('new-token');
    expect(readAuth()?.clientId).toBe('c1'); // other fields preserved
  });
});

describe('authedFetch and the shared refresh', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  const rotating = (): Mock<FetchStub> =>
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/token')) {
        await new Promise((r) => setTimeout(r, 20)); // keep the grant in flight
        return jsonResponse(200, { access_token: 'new-token', refresh_token: 'rt-2' });
      }
      const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
      return bearer === 'Bearer new-token' ? jsonResponse(200, {}) : jsonResponse(401, {});
    });

  it('returns the raw response for any status, passing the caller init through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'x' }));
    useFetch(fetchMock);
    const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
    const res = await authedFetch(makeAuth(), target, 'https://x.example/api', init);
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledWith('https://x.example/api', {
      ...init,
      headers: { 'content-type': 'application/json', authorization: 'Bearer old-token' },
    });
  });

  it('refreshes once for parallel 401s that share a refresh token', async () => {
    const fetchMock = rotating();
    useFetch(fetchMock);
    saveAuth(makeAuth());
    const [a, b] = [makeAuth(), makeAuth()];
    const results = await Promise.all([
      authedFetch(a, target, 'https://x.example/1'),
      authedFetch(b, target, 'https://x.example/2'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/token'))).toHaveLength(1);
    expect([a.tokens.refreshToken, b.tokens.refreshToken]).toEqual(['rt-2', 'rt-2']);
    expect(readAuth()?.tokens.refreshToken).toBe('rt-2');
  });

  it('does not persist refreshed tokens over a sign-in by another client', async () => {
    useFetch(
      vi.fn(async () => {
        saveAuth({ ...makeAuth({ accessToken: 'theirs' }), clientId: 'c2' }); // lands mid-refresh
        return jsonResponse(200, { access_token: 'new-token', expires_in: 60 });
      })
    );
    saveAuth(makeAuth());
    const auth = makeAuth();
    await refreshOrThrow(auth, target);
    expect(auth.tokens.accessToken).toBe('new-token'); // in-memory retry still works
    expect(readAuth()).toMatchObject({ clientId: 'c2', tokens: { accessToken: 'theirs' } });
  });

  it('throws TransientAuthError when the refresh network call fails', async () => {
    useFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(refreshOrThrow(makeAuth(), target)).rejects.toThrow(TransientAuthError);
  });
});
