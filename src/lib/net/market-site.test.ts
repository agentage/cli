import { createServer, type RequestListener, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { cliFetch } from './fetch.js';
import { listMarket, openMarket } from './market.js';

const servers: Server[] = [];

const serve = async (handler: RequestListener): Promise<number> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
};

// A port nothing listens on: a server opened, then closed.
const closedPort = async (): Promise<number> => {
  const port = await serve(() => undefined);
  await new Promise((done) => servers.pop()?.close(done));
  return port;
};

// A site that serves its discovery document (404: none) and nothing else.
const site = (discovery: unknown): Promise<number> =>
  serve((req, res) => {
    if (req.url !== '/.well-known/agentage.json' || discovery === 404)
      return void res.writeHead(404).end('not here');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(discovery));
  });

// The market at a port of its own, named by the site's discovery document.
const withMarket = async (market: RequestListener | number): Promise<string> => {
  const at = typeof market === 'number' ? market : await serve(market);
  return `127.0.0.1:${await site({ markets: [`http://127.0.0.1:${at}`] })}`;
};

const short = (url: string) => cliFetch(url, {}, { timeoutMs: 300 });

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

describe('a site and its market, over a real socket: one code per way it fails', () => {
  it('no discovery document (404): names the site, its URL and AGENTAGE_SITE_FQDN', async () => {
    const fqdn = `127.0.0.1:${await site(404)}`;
    const err = await listMarket(fqdn).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'no_discovery' });
    expect((err as Error).message).toBe(
      `${fqdn} has no extension market: http://${fqdn}/.well-known/agentage.json answered 404; ` +
        'choose another site with AGENTAGE_SITE_FQDN=<site>'
    );
  });

  it('a redirect or a sign-in page (200, HTML) is market_unreachable, not "no market"', async () => {
    const portal = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>sign in to the wifi</html>');
    });
    const redirect = await serve((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${portal}/login` }).end();
    });
    for (const [port, why] of [
      [portal, 'answered 200 with no JSON object'],
      [redirect, `answered 302 to http://127.0.0.1:${portal}/login`],
    ] as const) {
      const url = `http://127.0.0.1:${port}/.well-known/agentage.json`;
      await expect(listMarket(`127.0.0.1:${port}`)).rejects.toMatchObject({
        code: 'market_unreachable',
        message: `${url} ${why}: not the discovery document; check the network`,
      });
    }
  });

  it('a discovery document that names no market', async () => {
    const fqdn = `127.0.0.1:${await site({ platform: 'http://p.test' })}`;
    const err = await listMarket(fqdn).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'no_market' });
    expect((err as Error).message).toMatch(
      /^127\.0\.0\.1:\d+ has no extension market: .* names none;/
    );
    expect((err as Error).message).toContain('AGENTAGE_SITE_FQDN');
  });

  it('a site nobody answers on, and a market nobody answers on, are market_unreachable', async () => {
    const down = `127.0.0.1:${await closedPort()}`;
    await expect(listMarket(down)).rejects.toMatchObject({
      code: 'market_unreachable',
      message: expect.stringMatching(/^cannot reach http:\/\/127.*: connect ECONNREFUSED/),
    });
    const market = openMarket(await withMarket(await closedPort()));
    expect(await market.latest('probe')).toBeNull();
    expect(market.down()).toMatchObject({ code: 'market_unreachable' });
  });

  it('a market that answers 503 is market_failed', async () => {
    const fqdn = await withMarket((_req, res) => res.writeHead(503).end());
    await expect(listMarket(fqdn)).rejects.toMatchObject({
      code: 'market_failed',
      message: expect.stringMatching(/\/api\/v1\/extensions\?limit=200 answered 503$/),
    });
  });

  it('a market that never answers is market_timeout', async () => {
    const fqdn = await withMarket(() => undefined);
    await expect(listMarket(fqdn, short)).rejects.toMatchObject({
      code: 'market_timeout',
      message: expect.stringMatching(/did not answer in 5 s$/),
    });
  });
});
