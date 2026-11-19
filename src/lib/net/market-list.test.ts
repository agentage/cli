import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PAGES } from '@agentage/extension/core';
import { listMarket } from './market.js';
import { doc, named, serving, unknownId } from '../../test/market-stub.js';

const DISCOVERY = 'https://next.agentage.io/.well-known/agentage.json';
const BASE = 'https://market.test/api/market/extensions';
const LIST = `${BASE}?limit=200`;
const entry = { data: { id: 'probe', version: '0.3.0', package: '@agentage/extension-probe' } };
const row = (id: string, version?: string) => ({ id, package: null, ...(version && { version }) });
const page = (rows: unknown[], nextCursor?: string) =>
  doc({ success: true, data: rows, meta: { pagination: { limit: 200, nextCursor } } });

const list = (routes: Record<string, Response | Error> | typeof fetch) => {
  const get = vi.fn(typeof routes === 'function' ? routes : serving(routes));
  return { get, listing: listMarket('next.agentage.io', { get, fetch: get }) };
};

afterEach(() => vi.unstubAllEnvs());

describe('listMarket: extension list --available', () => {
  it('reads every page by meta.pagination.nextCursor; a row without a version asks /latest', async () => {
    const { listing } = list({
      [DISCOVERY]: doc(named),
      [LIST]: page([row('notes', '1.2.0')], 'c 2'),
      [`${LIST}&cursor=c%202`]: page([row('probe'), row('gone')]),
      [`${BASE}/probe/latest`]: doc(entry),
      [`${BASE}/gone/latest`]: unknownId('gone'),
    });
    expect(await listing).toEqual({
      offered: [
        { id: 'notes', version: '1.2.0' },
        { id: 'probe', version: '0.3.0' },
      ],
      skipped: [{ id: 'gone', reason: 'the market has no version of it' }],
      down: null,
    });
  });

  it('a market that repeats its cursor stops after MAX_PAGES: an empty list and why', async () => {
    const { get, listing } = list(async (url) =>
      String(url) === DISCOVERY ? doc(named) : page([row('notes', '1.2.0')], 'same')
    );
    const { offered, down } = await listing;
    expect(offered).toEqual([]);
    expect(down).toMatchObject({ code: 'market_failed' });
    expect(down?.message).toContain(`more than ${MAX_PAGES} pages`);
    expect(get).toHaveBeenCalledTimes(MAX_PAGES + 1);
  });

  it('a row whose /latest fails or answers a bad entry is skipped with its reason', async () => {
    const bad = { data: { id: 'evil', version: '1.0.0', package: 'left-pad' } };
    const { listing } = list({
      [DISCOVERY]: doc(named),
      [LIST]: page([row('notes', '1.2.0'), row('probe'), row('evil')]),
      [`${BASE}/probe/latest`]: doc({}, 503),
      [`${BASE}/evil/latest`]: doc(bad),
    });
    expect(await listing).toEqual({
      offered: [{ id: 'notes', version: '1.2.0' }],
      skipped: [
        { id: 'probe', reason: `${BASE}/probe/latest answered 503` },
        {
          id: 'evil',
          reason:
            'market answer refused for evil: package "left-pad" is not an extension of that id',
        },
      ],
      down: null,
    });
  });

  it.each([
    ['a list call that fails', 'market_failed', { [DISCOVERY]: doc(named), [LIST]: doc({}, 502) }],
    ['no market', 'no_discovery', {}],
  ])('%s: an empty list and the reason, never a throw', async (_n, code, routes) => {
    const { offered, skipped, down } = await list(routes).listing;
    expect({ offered, skipped }).toEqual({ offered: [], skipped: [] });
    expect(down).toMatchObject({ code });
  });

  it('a closed core address: market not reachable, from the env, no discovery read', async () => {
    vi.stubEnv('AGENTAGE_CORE_URL', 'http://127.0.0.1:9');
    const { get, listing } = list(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') });
    });
    const { down } = await listing;
    expect(down).toMatchObject({ code: 'market_unreachable' });
    expect(down?.message).toMatch(/^market not reachable: /);
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:9/api/market/extensions?limit=200',
    ]);
  });
});
