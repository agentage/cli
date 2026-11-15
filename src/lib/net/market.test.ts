import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMarket, MAX_PAGES, openMarket } from './market.js';

const DISCOVERY = 'https://next.agentage.io/.well-known/agentage.json';
const LATEST = 'https://market.test/api/v1/extensions/probe/latest';

const serving = (routes: Record<string, Response | Error>) => async (url: string) => {
  const found = routes[url] ?? new Response('{}', { status: 404 });
  if (found instanceof Error) throw found;
  return found.clone();
};

const doc = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const named = { markets: ['https://market.test/'] };
const entry = { data: { id: 'probe', version: '0.3.0', package: '@agentage/extension-probe' } };

afterEach(() => vi.restoreAllMocks());

describe('openMarket', () => {
  it('takes the market address from the discovery document and reads /latest', async () => {
    const get = serving({ [DISCOVERY]: doc(named), [LATEST]: doc(entry) });
    const market = openMarket('next.agentage.io', get);
    expect(await market.latest('probe')).toEqual({
      version: '0.3.0',
      package: '@agentage/extension-probe',
    });
  });

  it('answers null for an id the market does not know, with no message', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const market = openMarket('next.agentage.io', serving({ [DISCOVERY]: doc(named) }));
    expect(await market.latest('probe')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a private entry as package null', async () => {
    const data = { data: { version: '0.2.1', package: null } };
    const get = serving({ [DISCOVERY]: doc(named), [LATEST]: doc(data) });
    expect(await openMarket('next.agentage.io', get).latest('probe')).toEqual({
      version: '0.2.1',
      package: null,
    });
  });

  it.each([
    [
      'no markets field',
      'no_market',
      serving({ [DISCOVERY]: doc({ platform: 'https://p.test' }) }),
    ],
    ['no discovery document', 'no_discovery', serving({})],
    [
      'a market answering 503',
      'market_failed',
      serving({ [DISCOVERY]: doc(named), [LATEST]: doc({}, 503) }),
    ],
    [
      'a market that cannot be reached',
      'market_unreachable',
      serving({ [DISCOVERY]: doc(named), [LATEST]: new Error('offline') }),
    ],
  ])(
    'answers null on %s and keeps the first reason, %s, printing nothing',
    async (_n, code, get) => {
      const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const market = openMarket('next.agentage.io', get);
      expect(await market.latest('probe')).toBeNull();
      expect(await market.latest('fixture')).toBeNull();
      expect(market.down()).toMatchObject({ code });
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a foreign package', { version: '1.0.0', package: '@evil/probe' }],
    ['another id', { version: '1.0.0', package: '@agentage/extension-other' }],
    ['a URL as the package', { version: '1.0.0', package: 'https://evil.test/p.tgz' }],
    ['a missing package', { version: '1.0.0' }],
    ['a range *', { version: '*', package: '@agentage/extension-probe' }],
    ['a range ^1.0.0', { version: '^1.0.0', package: '@agentage/extension-probe' }],
    ['a dist-tag', { version: 'latest', package: '@agentage/extension-probe' }],
    [
      'a URL as the version',
      { version: 'https://evil.test/p.tgz', package: 'agentage-extension-probe' },
    ],
    ['an empty version', { version: '', package: '@agentage/extension-probe' }],
  ])('refuses %s on one clear line, never a package', async (_name, data) => {
    const get = serving({ [DISCOVERY]: doc(named), [LATEST]: doc({ data }) });
    await expect(openMarket('next.agentage.io', get).latest('probe')).rejects.toThrow(
      /^market answer refused for probe: /
    );
  });

  it('accepts the unscoped full name', async () => {
    const data = { data: { version: '1.2.3-beta.1', package: 'agentage-extension-probe' } };
    const get = serving({ [DISCOVERY]: doc(named), [LATEST]: doc(data) });
    expect((await openMarket('next.agentage.io', get).latest('probe'))?.version).toBe(
      '1.2.3-beta.1'
    );
  });

  it.each(['http://market.test/', 'ftp://market.test/', 'market.test'])(
    'treats the market address %s as no market',
    async (url) => {
      const get = serving({ [DISCOVERY]: doc({ markets: [url] }) });
      const market = openMarket('next.agentage.io', get);
      expect(await market.latest('probe')).toBeNull();
      expect(market.down()).toMatchObject({ code: 'no_market' });
    }
  );
});

describe('listMarket: extension list --available', () => {
  const LIST = 'https://market.test/api/v1/extensions?limit=200';
  const row = (id: string, version?: string) => ({
    id,
    package: null,
    ...(version && { version }),
  });

  it('a market that repeats its cursor stops after MAX_PAGES with a clear message', async () => {
    const page = () =>
      doc({ success: true, data: [row('notes', '1.2.0')], meta: { nextCursor: 'same' } });
    const get = vi.fn(async (url: string) =>
      url === DISCOVERY ? doc(named) : url.startsWith(LIST) ? page() : doc({}, 404)
    );
    await expect(listMarket('next.agentage.io', get)).rejects.toThrow(
      `the market list has more than ${MAX_PAGES} pages of 200; stopped there`
    );
    expect(get).toHaveBeenCalledTimes(MAX_PAGES + 1);
  });

  it('reads every page by meta.nextCursor; a row without a version asks /latest', async () => {
    const get = serving({
      [DISCOVERY]: doc(named),
      [LIST]: doc({ success: true, data: [row('notes', '1.2.0')], meta: { nextCursor: 'c 2' } }),
      [`${LIST}&cursor=c%202`]: doc({ success: true, data: [row('probe'), row('gone')] }),
      [LATEST]: doc(entry),
    });
    expect(await listMarket('next.agentage.io', get)).toEqual([
      { id: 'notes', version: '1.2.0' },
      { id: 'probe', version: '0.3.0' },
    ]);
  });

  it('no market: it throws, so the command fails', async () => {
    await expect(listMarket('next.agentage.io', serving({}))).rejects.toMatchObject({
      code: 'no_discovery',
    });
  });
});
