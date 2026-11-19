import { createServer, type RequestListener, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { listMarket, openMarket, type MarketDeps } from './market.js';

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

// A list never throws: the reason it is empty.
const downOf = async (fqdn: string, deps?: Partial<MarketDeps>) =>
  (await listMarket(fqdn, deps)).down;

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

describe('a site and its market, over a real socket: one code per way it fails', () => {
  it('no discovery document (404): names the site, its URL and AGENTAGE_SITE_FQDN', async () => {
    const fqdn = `127.0.0.1:${await site(404)}`;
    const err = await downOf(fqdn);
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
      expect(await downOf(`127.0.0.1:${port}`)).toMatchObject({
        code: 'market_unreachable',
        message: `market not reachable: ${url} ${why}: not the discovery document; check the network`,
      });
    }
  });

  it('a discovery document that names no market', async () => {
    const fqdn = `127.0.0.1:${await site({ platform: 'http://p.test' })}`;
    const err = await downOf(fqdn);
    expect(err).toMatchObject({ code: 'no_market' });
    expect((err as Error).message).toMatch(
      /^127\.0\.0\.1:\d+ has no extension market: .* names none;/
    );
    expect((err as Error).message).toContain('AGENTAGE_SITE_FQDN');
  });

  it('a site nobody answers on, and a market nobody answers on, are market_unreachable', async () => {
    const down = `127.0.0.1:${await closedPort()}`;
    expect(await downOf(down)).toMatchObject({
      code: 'market_unreachable',
      message: expect.stringMatching(
        /^market not reachable: cannot reach http:\/\/127.*: connect ECONNREFUSED/
      ),
    });
    const market = openMarket(await withMarket(await closedPort()));
    expect(await market.latest('probe')).toBeNull();
    expect(market.down()).toMatchObject({ code: 'market_unreachable' });
  });

  it('a market that answers 503 is market_failed: market not reachable', async () => {
    const fqdn = await withMarket((_req, res) => res.writeHead(503).end());
    expect(await downOf(fqdn)).toMatchObject({
      code: 'market_failed',
      message: expect.stringMatching(
        /^market not reachable: .*\/api\/market\/extensions\?limit=200 answered 503$/
      ),
    });
  });

  it('a market that never answers is market_timeout, within its bound', async () => {
    const fqdn = await withMarket(() => undefined);
    const started = Date.now();
    expect(await downOf(fqdn, { timeoutMs: 300 })).toMatchObject({
      code: 'market_timeout',
      message: 'market not reachable: the core market (300 ms) did not answer in time',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
