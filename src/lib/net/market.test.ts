import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMarket } from './market.js';

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
    ['no markets field', serving({ [DISCOVERY]: doc({ platform: 'https://p.test' }) })],
    ['no discovery document', serving({})],
    ['a market answering 503', serving({ [DISCOVERY]: doc(named), [LATEST]: doc({}, 503) })],
    [
      'a market that times out',
      serving({ [DISCOVERY]: doc(named), [LATEST]: new Error('timeout') }),
    ],
  ])('prints one line and answers null on %s', async (_name, get) => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const market = openMarket('next.agentage.io', get);
    expect(await market.latest('probe')).toBeNull();
    expect(await market.latest('fixture')).toBeNull();
    expect(market.down()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('market unavailable, versions not checked');
  });

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
      const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const get = serving({ [DISCOVERY]: doc({ markets: [url] }) });
      expect(await openMarket('next.agentage.io', get).latest('probe')).toBeNull();
      expect(warn).toHaveBeenCalledWith('market unavailable, versions not checked');
    }
  );
});
