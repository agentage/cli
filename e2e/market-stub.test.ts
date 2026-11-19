/**
 * @offline - `extension list --available` against a loopback market at /api/market/extensions;
 * a v13 market (only /api/v1/extensions) is not reachable: an empty list, exit 0.
 */
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';
import { stubEnv, type StubSite } from './stub/auth-server.js';

const ROWS = { success: true, data: [{ id: 'probe', version: '0.2.0' }] };

// A site that is its own market, serving the list under `prefix` only; the rest is a JSON 404.
const startMarket = async (prefix: string): Promise<{ fqdn: string; server: Server }> => {
  const server = createServer((req, res) => {
    const origin = `http://${req.headers.host ?? ''}`;
    const path = (req.url ?? '').split('?')[0];
    const body =
      path === '/.well-known/agentage.json'
        ? { markets: [origin] }
        : path === `${prefix}/extensions`
          ? ROWS
          : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { success: false, error: { code: 'NOT_FOUND' } }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { fqdn: `127.0.0.1:${(server.address() as AddressInfo).port}`, server };
};

test.beforeAll(assertCliBuilt);

test('extension list --available lists a market at /api/market/extensions @offline', async () => {
  const { fqdn, server } = await startMarket('/api/market');
  const machine = createCliMachine(stubEnv({ fqdn } as StubSite));
  try {
    const result = await machine.exec(['extension', 'list', '--available', '--json']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('"probe"');
    expect(result.stdout).toContain('"0.2.0"');
  } finally {
    machine.cleanup();
    await new Promise((done) => server.close(done));
  }
});

test('a v13 market (only /api/v1/extensions) is not reachable: empty, exit 0 @offline', async () => {
  const { fqdn, server } = await startMarket('/api/v1');
  const machine = createCliMachine(stubEnv({ fqdn } as StubSite));
  try {
    const result = await machine.exec(['extension', 'list', '--available']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/^market not reachable: .*answered 404/);
  } finally {
    machine.cleanup();
    await new Promise((done) => server.close(done));
  }
});
