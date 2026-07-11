import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authedGet,
  authedPost,
  AuthRequiredError,
  currentBearer,
  introspectToken,
  refreshOrThrow,
  TransientAuthError,
} from './api.js';
import { patAuthState } from './credentials.js';
import { readAuth, type AuthState } from '../fs/config.js';
import { links } from '../net/origins.js';
import { VERSION } from '../../utils/version.js';

const target = links('dev.agentage.io');

// The CLI version headers requestHeaders() adds to every authed request.
const versionHeaders = {
  'User-Agent': `agentage-cli/${VERSION}`,
  'X-Agentage-CLI-Version': VERSION,
  'X-Agentage-Daemon-Version': 'none',
};

const makeAuth = (overrides: Partial<AuthState['tokens']> = {}): AuthState => ({
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'old-token', refreshToken: 'rt', ...overrides },
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('authedGet', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('sends the bearer token and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await authedGet<{ ok: boolean }>(makeAuth(), target, 'https://x.example/me');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://x.example/me', {
      headers: { authorization: 'Bearer old-token', ...versionHeaders },
      redirect: 'manual',
    });
  });

  it('sends the CLI version identification headers alongside the bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await authedGet(makeAuth(), target, 'https://x.example/me');
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(`agentage-cli/${VERSION}`);
    expect(headers['X-Agentage-CLI-Version']).toBe(VERSION);
    expect(headers['X-Agentage-Daemon-Version']).toBe('none');
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
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth();
    const result = await authedGet<{ ok: boolean }>(auth, target, 'https://x.example/me');
    expect(result.ok).toBe(true);
    expect(auth.tokens.accessToken).toBe('new-token');
    expect(readAuth()?.tokens.accessToken).toBe('new-token');
  });

  it('throws AuthRequiredError when 401 and no refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    await expect(
      authedGet(makeAuth({ refreshToken: undefined }), target, 'https://x.example/me')
    ).rejects.toThrow(AuthRequiredError);
  });

  it('throws AuthRequiredError when the refresh itself fails', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.includes('/token') ? jsonResponse(400, {}) : jsonResponse(401, {}))
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(authedGet(makeAuth(), target, 'https://x.example/me')).rejects.toThrow(
      AuthRequiredError
    );
  });

  it('surfaces non-auth errors with the status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    await expect(authedGet(makeAuth(), target, 'https://x.example/x')).rejects.toThrow('500');
  });

  it('refuses to follow a redirect and reports its status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(302, {}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(authedGet(makeAuth(), target, 'https://x.example/me')).rejects.toThrow(
      'refused redirect (302)'
    );
    expect(fetchMock).toHaveBeenCalledWith('https://x.example/me', {
      headers: { authorization: 'Bearer old-token', ...versionHeaders },
      redirect: 'manual',
    });
  });
});

describe('authedPost', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('sends the bearer token, a JSON body, and returns the raw response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await authedPost(makeAuth(), target, 'https://x.example/api/memories', {
      name: 'acct',
      channel: 'couch',
    });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith('https://x.example/api/memories', {
      method: 'POST',
      headers: {
        authorization: 'Bearer old-token',
        'content-type': 'application/json',
        ...versionHeaders,
      },
      body: JSON.stringify({ name: 'acct', channel: 'couch' }),
      redirect: 'manual',
    });
  });

  it('refreshes once on 401, persists the new tokens, and retries the POST', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/token'))
        return Promise.resolve(jsonResponse(200, { access_token: 'new-token', expires_in: 60 }));
      const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
      return Promise.resolve(
        bearer === 'Bearer new-token' ? jsonResponse(201, { ok: true }) : jsonResponse(401, {})
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth();
    const res = await authedPost(auth, target, 'https://x.example/api/memories', { name: 'a' });
    expect(res.status).toBe(201);
    expect(auth.tokens.accessToken).toBe('new-token');
    expect(readAuth()?.tokens.accessToken).toBe('new-token');
  });

  it('returns a non-2xx response without throwing so the caller can branch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'X' } })));
    const res = await authedPost(makeAuth(), target, 'https://x.example/api/memories', {});
    expect(res.status).toBe(403);
  });
});

describe('currentBearer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-api-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('returns a valid unexpired token as-is, with zero network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth({ accessToken: 'live-token', expiresAt: Date.now() + 60_000 });
    const bearer = await currentBearer(() => auth, target);
    expect(bearer).toBe('live-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes exactly once on an expired token, returns and persists the new bearer', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/token')
          ? jsonResponse(200, {
              access_token: 'fresh-token',
              refresh_token: 'rt2',
              expires_in: 3600,
            })
          : jsonResponse(500, {})
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth({ accessToken: 'stale-token', expiresAt: Date.now() - 1000 });
    const bearer = await currentBearer(() => auth, target);
    expect(bearer).toBe('fresh-token');
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(readAuth()?.tokens.accessToken).toBe('fresh-token');
  });

  it('returns null (never throws) when the refresh fails', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/token') ? jsonResponse(400, {}) : jsonResponse(200, {})
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth({ accessToken: 'stale-token', expiresAt: Date.now() - 1000 });
    await expect(currentBearer(() => auth, target)).resolves.toBeNull();
  });

  it('returns null with no refresh attempt when an expired token has no refresh token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth({ expiresAt: Date.now() - 1000, refreshToken: undefined });
    await expect(currentBearer(() => auth, target)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when signed out (no stored access token)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(currentBearer(() => null, target)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
    vi.unstubAllGlobals();
  });

  it('calls the introspection endpoint and maps the session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: '2026-06-12T20:00:00Z' })
      );
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', fetchMock);
    const auth = makeAuth();
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
    vi.stubGlobal('fetch', fetchMock);
    await expect(introspectToken(makeAuth(), target)).rejects.toThrow(AuthRequiredError);
  });

  it('throws TransientAuthError (not AuthRequired) when a 200 + null refresh blips 429', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/token') ? jsonResponse(429, {}) : jsonResponse(200, null)
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(introspectToken(makeAuth(), target)).rejects.toThrow(TransientAuthError);
  });

  it('reports the unexpired stored token as signed-in when get-session blips 5xx', async () => {
    const expiresAt = Date.now() + 3_600_000;
    const fetchMock = vi.fn(async () => jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', fetchMock);
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
    vi.unstubAllGlobals();
  });

  const pat = patAuthState('aga_test123', 'dev.agentage.io');

  it('sends the PAT as the Bearer on an authed GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await authedGet(pat, target, 'https://memory.dev.agentage.io/mcp/me');
    expect(fetchMock).toHaveBeenCalledWith('https://memory.dev.agentage.io/mcp/me', {
      headers: { authorization: 'Bearer aga_test123', ...versionHeaders },
      redirect: 'manual',
    });
  });

  it('sends the PAT as the Bearer on an authed POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await authedPost(pat, target, 'https://memory.dev.agentage.io/mcp', { jsonrpc: '2.0' });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer aga_test123');
  });

  it('refuses to refresh a PAT (no OAuth refresh grant) with a dashboard-pointing message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(refreshOrThrow(pat, target)).rejects.toThrow(AuthRequiredError);
    await expect(refreshOrThrow(pat, target)).rejects.toThrow(/personal access token/);
    // Never hits the token endpoint - a PAT cannot be refreshed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not attempt a refresh on a 401 (a PAT is terminal on 401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(authedGet(pat, target, 'https://memory.dev.agentage.io/mcp/me')).rejects.toThrow(
      AuthRequiredError
    );
    // Exactly one call (the original) - no /token refresh attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
