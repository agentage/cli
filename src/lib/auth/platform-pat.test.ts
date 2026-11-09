import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { readAuth, saveAuth, type AuthState } from '../fs/config.js';
import { links } from '../net/origins.js';
import { platformFetch, revokePlatformPats } from './platform-pat.js';

const DAY_S = 86_400;

// An issuer minting tok_<n> for the session bearer at_1, and a platform taking only the newest.
const site = async (calls: string[], opts: { expiresInS?: number; platform?: number } = {}) => {
  let n = 0;
  const server = createServer((req, res) => {
    req.resume().on('end', () => {
      const bearer = String(req.headers.authorization ?? '').replace('Bearer ', '');
      calls.push(`${req.method} ${req.url} ${bearer}`);
      if (req.url === '/account/pat' && bearer === 'at_1') {
        n += 1;
        const expiresAt = new Date(Date.now() + (opts.expiresInS ?? 30 * DAY_S) * 1000);
        const data = { id: `tok_${n}`, token: `aga_jwt_${n}`, expiresAt: expiresAt.toISOString() };
        return void res.writeHead(201).end(JSON.stringify({ success: true, data }));
      }
      if (req.url?.startsWith('/account/pat'))
        return void res.writeHead(req.method === 'DELETE' ? 200 : 401).end();
      res.writeHead(opts.platform ?? (bearer === `aga_jwt_${n}` ? 204 : 401)).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const servers: Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});

const signedIn = (base: string, extra: Partial<AuthState> = {}): AuthState => {
  const auth = { siteFqdn: 'x', issuer: base, clientId: 'c', tokens: { accessToken: 'at_1' } };
  saveAuth({ ...auth, ...extra });
  return { ...auth, ...extra };
};

const go = (auth: AuthState, base: string, issuer = base, discovered = true) => {
  const to = { ...links('x'), auth: base };
  const found = {
    links: { ...to, auth: issuer },
    platform: { url: base, machines: base },
    discovered,
  };
  return platformFetch(auth, to, found, '/m', {}, {});
};

describe('the platform token', () => {
  test('mints once with the session, keeps it by issuer, sends it to the platform', async () => {
    const calls: string[] = [];
    const base = await site(calls);
    expect((await go(signedIn(base), base)).status).toBe(204);
    expect((await go(readAuth()!, base)).status).toBe(204);
    expect(calls).toEqual(['POST /account/pat at_1', 'GET /m aga_jwt_1', 'GET /m aga_jwt_1']);
    expect(readAuth()?.platformPats?.[base]).toMatchObject({ id: 'tok_1', token: 'aga_jwt_1' });
  });

  test('within a day of expiry it mints a new one and revokes the old, unawaited', async () => {
    const calls: string[] = [];
    const base = await site(calls, { expiresInS: DAY_S / 2 });
    await go(signedIn(base), base);
    await go(readAuth()!, base);
    await vi.waitFor(() => expect(calls).toContain('DELETE /account/pat/tok_1 at_1'));
    expect(calls).toContain('GET /m aga_jwt_2');
  });

  test('a stored token the platform refuses is replaced once and the call retried', async () => {
    const calls: string[] = [];
    const base = await site(calls);
    const stale = { id: 'tok_0', token: 'aga_old', expiresAt: '2099-01-01T00:00:00.000Z' };
    expect((await go(signedIn(base, { platformPats: { [base]: stale } }), base)).status).toBe(204);
    await vi.waitFor(() => expect(calls).toContain('DELETE /account/pat/tok_0 at_1'));
    expect(calls.filter((c) => c.startsWith('GET'))).toEqual([
      'GET /m aga_old',
      'GET /m aga_jwt_1',
    ]);
  });

  test('a refused mint prints one line, never falls back, and is not retried in the run', async () => {
    const calls: string[] = [];
    const base = await site(calls);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = signedIn(base, { tokens: { accessToken: 'at_other' } });
    await expect(go(auth, base)).rejects.toThrow(
      /^platform token refused \(401\): auth may be older than /
    );
    await expect(go(auth, base)).rejects.toThrow('platform token refused');
    expect(calls).toEqual(['POST /account/pat at_other']);
    expect(err).toHaveBeenCalledOnce();
  });

  test('a fresh token the platform refuses stops the run: no second mint', async () => {
    const calls: string[] = [];
    const base = await site(calls, { platform: 401 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(go(signedIn(base), base)).rejects.toThrow('refused (401) by the platform');
    await expect(go(readAuth()!, base)).rejects.toThrow();
    expect(calls).toEqual(['POST /account/pat at_1', 'GET /m aga_jwt_1']);
  });

  test("refuses when the site's issuer is not the session's; an undiscovered site keeps the session bearer", async () => {
    const calls: string[] = [];
    const base = await site(calls, { platform: 204 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(go(signedIn(base), base, 'https://other.example')).rejects.toThrow('issuer');
    const plain = await site(calls, { platform: 204 });
    expect((await go(signedIn(plain), plain, plain, false)).status).toBe(204);
    expect(calls).toEqual(['GET /m at_1']);
  });

  test('revokes every stored token with the bearer given', async () => {
    const calls: string[] = [];
    const base = await site(calls);
    const pat = { id: 'tok_9', token: 't', expiresAt: '2099-01-01T00:00:00.000Z' };
    await revokePlatformPats(signedIn(base, { platformPats: { [base]: pat } }), 'at_new');
    expect(calls).toEqual(['DELETE /account/pat/tok_9 at_new']);
  });
});
