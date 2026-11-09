import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { readAuth, saveAuth, type AuthState } from '../fs/config.js';
import { links } from '../net/origins.js';
import { platformFetch } from './platform-pat.js';

interface Call {
  method: string;
  url: string;
  bearer: string;
  body: string;
}

const DAY_S = 86_400;

// An issuer minting tok_<n> JWT PATs for the session bearer, and a platform taking only the newest.
const site = async (calls: Call[], expiresInS = 30 * DAY_S) => {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const bearer = String(req.headers.authorization ?? '').replace('Bearer ', '');
      calls.push({ method: req.method ?? '', url: req.url ?? '', bearer, body });
      if (req.url === '/account/pat' && bearer === 'at_1') {
        n += 1;
        const expiresAt = new Date(Date.now() + expiresInS * 1000).toISOString();
        const data = { id: `tok_${n}`, token: `aga_jwt_${n}`, expiresAt };
        return void res.writeHead(201).end(JSON.stringify({ success: true, data }));
      }
      if (req.url?.startsWith('/account/pat/')) return void res.writeHead(200).end('{}');
      res.writeHead(bearer === `aga_jwt_${n}` ? 204 : 401).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const signedIn = (base: string): AuthState => {
  const auth = { siteFqdn: 'x', issuer: base, clientId: 'c', tokens: { accessToken: 'at_1' } };
  saveAuth(auth);
  return auth;
};

const route = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url} ${c.bearer}`);

describe('the platform token', () => {
  test('mints once with the session, keeps it by issuer, sends it to the platform', async () => {
    const calls: Call[] = [];
    const { server, base } = await site(calls);
    servers.push(server);
    const auth = signedIn(base);
    const to = { ...links('x'), auth: base };
    expect((await platformFetch(auth, to, `${base}/m`)).status).toBe(204);
    expect((await platformFetch(readAuth()!, to, `${base}/m`)).status).toBe(204);
    expect(route(calls)).toEqual([
      `POST /account/pat at_1`,
      `GET /m aga_jwt_1`,
      `GET /m aga_jwt_1`,
    ]);
    expect(JSON.parse(calls[0]!.body)).toEqual({
      label: 'agentage cli',
      format: 'jwt',
      scopes: ['platform:read', 'platform:write'],
      expiresInDays: 30,
    });
    expect(readAuth()?.platformPats?.[base]).toMatchObject({ id: 'tok_1', token: 'aga_jwt_1' });
  });

  test('within a day of expiry it mints a new one and revokes the old', async () => {
    const calls: Call[] = [];
    const { server, base } = await site(calls, DAY_S / 2);
    servers.push(server);
    const to = { ...links('x'), auth: base };
    await platformFetch(signedIn(base), to, `${base}/m`);
    await platformFetch(readAuth()!, to, `${base}/m`);
    expect(route(calls).slice(2)).toEqual([
      `POST /account/pat at_1`,
      `DELETE /account/pat/tok_1 at_1`,
      `GET /m aga_jwt_2`,
    ]);
  });

  test('a platform 401 mints a new one, revokes the old and retries once', async () => {
    const calls: Call[] = [];
    const { server, base } = await site(calls);
    servers.push(server);
    const to = { ...links('x'), auth: base };
    const stale = { id: 'tok_0', token: 'aga_old', expiresAt: '2099-01-01T00:00:00.000Z' };
    const auth = { ...signedIn(base), platformPats: { [base]: stale } };
    expect((await platformFetch(auth, to, `${base}/m`)).status).toBe(204);
    expect(route(calls)).toEqual([
      `GET /m aga_old`,
      `POST /account/pat at_1`,
      `DELETE /account/pat/tok_0 at_1`,
      `GET /m aga_jwt_1`,
    ]);
  });

  test('a refused mint fails the call', async () => {
    const calls: Call[] = [];
    const { server, base } = await site(calls);
    servers.push(server);
    const auth = { ...signedIn(base), tokens: { accessToken: 'at_other' } };
    await expect(platformFetch(auth, { ...links('x'), auth: base }, `${base}/m`)).rejects.toThrow(
      'platform token: mint answered 401'
    );
  });
});
