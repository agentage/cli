import { afterEach, describe, expect, it, vi } from 'vitest';
import { doc, named, serving, unknownId } from '../../test/market-stub.js';
import { openMarket } from './market.js';

const DISCOVERY = 'https://next.agentage.io/.well-known/agentage.json';
const BASE = 'https://market.test/api/market/extensions';
const LATEST = `${BASE}/probe/latest`;

const entry = { data: { id: 'probe', version: '0.3.0', package: '@agentage/extension-probe' } };

const on = (routes: Record<string, Response | Error>) => {
  const get = vi.fn(serving(routes));
  return { get, market: openMarket('next.agentage.io', { get, fetch: get }) };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('openMarket', () => {
  it('takes the market address from the discovery document and reads /latest', async () => {
    const { market } = on({ [DISCOVERY]: doc(named), [LATEST]: doc(entry) });
    expect(await market.latest('probe')).toEqual({
      version: '0.3.0',
      package: '@agentage/extension-probe',
    });
  });

  it('reads the discovery document once for every call of one market', async () => {
    const { get, market } = on({ [DISCOVERY]: doc(named), [LATEST]: doc(entry) });
    await market.latest('probe');
    await market.latest('probe');
    expect(get.mock.calls.filter(([url]) => url === DISCOVERY)).toHaveLength(1);
  });

  it('the core address of the env wins over the discovery document', async () => {
    vi.stubEnv('AGENTAGE_CORE_URL', 'https://core.test');
    const at = 'https://core.test/api/market/extensions/probe/latest';
    const { get, market } = on({ [at]: doc(entry) });
    expect((await market.latest('probe'))?.version).toBe('0.3.0');
    expect(get.mock.calls.map(([url]) => url)).toEqual([at]);
  });

  it("answers null for an id the market's own 404 does not know, with no message", async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { market } = on({ [DISCOVERY]: doc(named), [LATEST]: unknownId('probe') });
    expect(await market.latest('probe')).toBeNull();
    expect(market.down()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a private entry as package null', async () => {
    const data = { data: { version: '0.2.1', package: null } };
    const { market } = on({ [DISCOVERY]: doc(named), [LATEST]: doc(data) });
    expect(await market.latest('probe')).toEqual({ version: '0.2.1', package: null });
  });

  it.each([
    ['no markets field', 'no_market', { [DISCOVERY]: doc({ platform: 'https://p.test' }) }],
    ['no discovery document', 'no_discovery', {}],
    [
      'a market answering 503',
      'market_failed',
      { [DISCOVERY]: doc(named), [LATEST]: doc({}, 503) },
    ],
    ['a route miss (a 404 not the market', 'market_failed', { [DISCOVERY]: doc(named) }],
    [
      'a v13 host (no /api/market)',
      'market_failed',
      {
        [DISCOVERY]: doc(named),
        'https://market.test/api/v1/extensions/probe/latest': doc(entry),
      },
    ],
    [
      'no connection',
      'market_unreachable',
      {
        [DISCOVERY]: doc(named),
        [LATEST]: new Error('offline'),
      },
    ],
  ])('answers null on %s and keeps the first reason, %s, printing nothing', async (_n, code, r) => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { market } = on(r);
    expect(await market.latest('probe')).toBeNull();
    expect(await market.latest('fixture')).toBeNull();
    expect(market.down()).toMatchObject({ code });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a silent market says market not reachable and why', async () => {
    const { market } = on({ [DISCOVERY]: doc(named), [LATEST]: doc({}, 503) });
    await market.latest('probe');
    expect(market.down()?.message).toBe(`market not reachable: ${LATEST} answered 503`);
  });

  it.each([
    ['a foreign package', { version: '1.0.0', package: '@evil/probe' }],
    ['another id', { version: '1.0.0', package: '@agentage/extension-other' }],
    ['a URL as the package', { version: '1.0.0', package: 'https://evil.test/p.tgz' }],
    ['a missing package', { version: '1.0.0' }],
    ['a range ^1.0.0', { version: '^1.0.0', package: '@agentage/extension-probe' }],
    ['a dist-tag', { version: 'latest', package: '@agentage/extension-probe' }],
    ['an empty version', { version: '', package: '@agentage/extension-probe' }],
  ])('refuses %s on one clear line, never a package', async (_name, data) => {
    const { market } = on({ [DISCOVERY]: doc(named), [LATEST]: doc({ data }) });
    await expect(market.latest('probe')).rejects.toThrow(/^market answer refused for probe: /);
  });

  it('accepts the unscoped full name', async () => {
    const data = { data: { version: '1.2.3-beta.1', package: 'agentage-extension-probe' } };
    const { market } = on({ [DISCOVERY]: doc(named), [LATEST]: doc(data) });
    expect((await market.latest('probe'))?.version).toBe('1.2.3-beta.1');
  });

  it.each(['http://market.test/', 'ftp://market.test/', 'market.test'])(
    'treats the market address %s as no market',
    async (url) => {
      const { market } = on({ [DISCOVERY]: doc({ markets: [url] }) });
      expect(await market.latest('probe')).toBeNull();
      expect(market.down()).toMatchObject({ code: 'no_market' });
    }
  );
});
