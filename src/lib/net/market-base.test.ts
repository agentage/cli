import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMarket, openMarket } from './market.js';
import { forgetRouteBases } from './route-base.js';

const DISCOVERY = 'https://next.agentage.io/.well-known/agentage.json';
const NEW = 'https://market.test/api/market/extensions';
const OLD = 'https://market.test/api/v1/extensions';

const doc = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const notFound = () =>
  doc({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
const entry = (version: string) => ({
  data: { id: 'probe', version, package: '@agentage/extension-probe' },
});

// A host serving `routes` (path under the market origin); the rest is the kit's NOT_FOUND.
const host = (routes: Record<string, () => Response>) =>
  vi.fn(async (url: string) =>
    url === DISCOVERY ? doc({ markets: ['https://market.test'] }) : (routes[url] ?? notFound)()
  );

afterEach(forgetRouteBases);

describe('the market base: /api/market first, the v13 /api/v1 on a missing route', () => {
  it('a one-image host answers at /api/market and is never asked at /api/v1', async () => {
    const get = host({ [`${NEW}/probe/latest`]: () => doc(entry('0.2.0')) });
    expect((await openMarket('next.agentage.io', get).latest('probe'))?.version).toBe('0.2.0');
    expect(get.mock.calls.map(([u]) => u)).not.toContainEqual(expect.stringContaining('/api/v1'));
  });

  it('a v13 market answers at /api/v1, and the next call goes there first', async () => {
    const get = host({ [`${OLD}/probe/latest`]: () => doc(entry('0.1.0')) });
    const market = openMarket('next.agentage.io', get);
    expect((await market.latest('probe'))?.version).toBe('0.1.0');
    get.mockClear();
    expect((await market.latest('probe'))?.version).toBe('0.1.0');
    expect(get.mock.calls.map(([u]) => u)).toEqual([`${OLD}/probe/latest`]);
  });

  it('an unknown id on a one-image host is null, and the base stays undecided', async () => {
    const get = host({});
    const market = openMarket('next.agentage.io', get);
    expect(await market.latest('nope')).toBeNull();
    expect(market.down()).toBeNull();
    get.mockClear();
    await market.latest('nope');
    expect(get.mock.calls[0]?.[0]).toBe(`${NEW}/nope/latest`);
  });

  it('a 503 at /api/market fails and decides nothing: no /api/v1 call', async () => {
    const get = host({ [`${NEW}/probe/latest`]: () => doc({}, 503) });
    const market = openMarket('next.agentage.io', get);
    expect(await market.latest('probe')).toBeNull();
    expect(market.down()).toMatchObject({ code: 'market_failed' });
    expect(get.mock.calls.map(([u]) => u)).not.toContainEqual(expect.stringContaining('/api/v1'));
  });

  it('extension list --available lists a v13 market by /api/v1', async () => {
    const rows = { success: true, data: [{ id: 'probe', version: '0.1.0' }] };
    const get = host({ [`${OLD}?limit=200`]: () => doc(rows) });
    expect((await listMarket('next.agentage.io', get)).offered).toEqual([
      { id: 'probe', version: '0.1.0' },
    ]);
  });

  it('extension list --available lists a one-image market by /api/market', async () => {
    const rows = { success: true, data: [{ id: 'probe', version: '0.2.0' }] };
    const get = host({ [`${NEW}?limit=200`]: () => doc(rows) });
    expect((await listMarket('next.agentage.io', get)).offered).toEqual([
      { id: 'probe', version: '0.2.0' },
    ]);
  });
});
