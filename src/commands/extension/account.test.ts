import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { signedInAccount } from './account.js';

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
}

// A loopback site answering get-session with a user, and anything else with 204.
const site = async (seen: Seen[]): Promise<{ server: Server; fqdn: string }> => {
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url !== '/api/auth/mcp/get-session') return void res.writeHead(204).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"userId":"user_1"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, fqdn: `127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const servers: Server[] = [];

afterEach(() => {
  delete process.env['AGENTAGE_SITE_FQDN'];
  for (const server of servers.splice(0)) server.close();
});

describe('the account the commands reach', () => {
  test('signed out, or signed in to another environment, there is none', ({ dir }) => {
    expect(signedInAccount()).toBeNull();
    dir.write('auth.json', {
      siteFqdn: 'dev.agentage.io',
      clientId: 'c',
      tokens: { accessToken: 'a' },
    });
    expect(signedInAccount()).toBeNull();
  });

  test('sends the bearer, x-client-type: cli and the headers given to the API origin, and reads the account id', async ({
    dir,
  }) => {
    const seen: Seen[] = [];
    const { server, fqdn } = await site(seen);
    servers.push(server);
    process.env['AGENTAGE_SITE_FQDN'] = fqdn;
    dir.write('auth.json', { siteFqdn: fqdn, clientId: 'c', tokens: { accessToken: 'at_1' } });
    const account = signedInAccount();
    const res = await account?.fetch('/v1/profile', { headers: { 'if-none-match': '"e"' } });
    expect(res?.status).toBe(204);
    expect(seen[0]).toMatchObject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: 'Bearer at_1', 'x-client-type': 'cli', 'if-none-match': '"e"' },
    });
    expect(await account?.id()).toBe('user_1');
  });

  test('a personal access token in --token is the bearer', async () => {
    const seen: Seen[] = [];
    const { server, fqdn } = await site(seen);
    servers.push(server);
    process.env['AGENTAGE_SITE_FQDN'] = fqdn;
    await signedInAccount({ token: 'aga_unit' })?.fetch('/v1/machines/m_0000beef/seen', {
      method: 'POST',
    });
    expect(seen[0]?.headers.authorization).toBe('Bearer aga_unit');
  });
});
