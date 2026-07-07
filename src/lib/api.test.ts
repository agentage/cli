import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedGet, authedPost, AuthRequiredError, introspectToken } from './api.js';
import { readAuth, type AuthState } from './config.js';
import { links } from './origins.js';

const target = links('dev.agentage.io');

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
      headers: { authorization: 'Bearer old-token' },
      redirect: 'manual',
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
      headers: { authorization: 'Bearer old-token' },
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
      headers: { authorization: 'Bearer old-token', 'content-type': 'application/json' },
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

describe('introspectToken', () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
