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
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('market unavailable, versions not checked');
  });
});
