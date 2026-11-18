import { createServer, type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchAccountUser } from './account-user.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => void servers.splice(0).forEach((s) => s.close()));

interface Seen {
  url?: string;
  auth?: string;
  body?: string;
}

// An auth issuer whose exchange answers `status` with `body`.
const issuer = async (status: number, body: unknown, seen: Seen = {}) => {
  const server = createServer((req: IncomingMessage, res) => {
    let text = '';
    req.on('data', (c: Buffer) => (text += c.toString()));
    req.on('end', () => {
      Object.assign(seen, { url: req.url, auth: req.headers.authorization, body: text });
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const answer = {
  success: true,
  data: { token: 'aga_short', expiresAt: 'x', user: { id: 'u1', email: 'a@b.c' } },
};

describe('fetchAccountUser', () => {
  it('asks the exchange of auth with the bearer and keeps only id and email', async () => {
    const seen: Seen = {};
    const user = await fetchAccountUser(await issuer(201, answer, seen), 'at-1');
    expect(user).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(JSON.stringify(user)).not.toContain('aga_short');
    expect(seen).toEqual({
      url: '/account/extension-token',
      auth: 'Bearer at-1',
      body: JSON.stringify({ extension: 'platform', access: 'read' }),
    });
  });

  it.each([
    [401, { success: false }],
    [403, { success: false }],
    [503, answer],
    [201, { success: true, data: { user: { id: 'u1' } } }],
    [201, 'not json'],
  ])('no user on %i %j', async (status, body) => {
    expect(await fetchAccountUser(await issuer(status, body), 'at-1')).toBeUndefined();
  });

  it('no user when auth is unreachable', async () => {
    expect(await fetchAccountUser('http://127.0.0.1:1', 'at-1')).toBeUndefined();
  });
});
