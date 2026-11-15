import { describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { manifestFromFixtures, npmFromFixtures } from '../../test/npm-fixtures.js';
import { CliError } from '../../lib/json-output.js';
import { type Market } from '../../lib/net/market.js';
import { cliInstaller } from './installer.js';

const PKG = '@agentage/fixture-probe';

const market = (latest: Awaited<ReturnType<Market['latest']>>): Market => ({
  latest: vi.fn(async () => latest),
  down: () => null,
});

const installer = async (m: Market) => {
  const npm = vi.fn(await npmFromFixtures());
  const deps = { npm: async () => npm, manifest: manifestFromFixtures(), market: () => m };
  return { install: cliInstaller(deps), npm };
};

describe('the daemon installer', () => {
  test('a bare id takes the market version into its own folder', async ({ dir }) => {
    const { install } = await installer(market({ version: '0.2.0', package: PKG }));
    const got = await install({ id: 'probe' });
    expect(got).toEqual({
      id: 'probe',
      version: '0.2.0',
      dir: dir.at(`extensions/packages/trees/probe@0.2.0/node_modules/${PKG}`),
    });
  });

  test('installed: the same exact version needs no market and no npm', async () => {
    const { install, npm } = await installer(market({ version: '0.2.0', package: PKG }));
    await install({ id: 'probe', version: '0.2.0' });
    const again = await installer(market(null));
    expect((await again.install({ id: 'probe', version: '0.2.0' })).version).toBe('0.2.0');
    expect(again.npm).not.toHaveBeenCalled();
    expect(npm).toHaveBeenCalledTimes(1);
  });

  test('a private market entry is refused; a package of another id too', async () => {
    const priv = await installer(market({ version: '1.0.0', package: null }));
    await expect(priv.install({ id: 'probe' })).rejects.toMatchObject({
      code: 'PRIVATE_ENTRY',
      status: 400,
    });
    const hello = await installer(market({ version: '1.0.0', package: '@agentage/fixture-hello' }));
    await expect(hello.install({ id: 'probe' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('agentage.id is hello'),
    });
  });

  test('a version npm does not have, or an id nobody has, is NOT_FOUND 404', async () => {
    const { install } = await installer(market({ version: '9.9.9', package: PKG }));
    await expect(install({ id: 'probe' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    const none = await installer(market(null));
    await expect(none.install({ id: 'nosuch' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test.each([
    ['no_discovery', 'NO_DISCOVERY'],
    ['no_market', 'NO_MARKET'],
    ['market_unreachable', 'MARKET_UNREACHABLE'],
    ['market_failed', 'MARKET_FAILED'],
    ['market_timeout', 'MARKET_TIMEOUT'],
  ] as const)('a market that fails with %s, no version given: %s 502', async (why, code) => {
    const reason = new CliError(why, 'agentage.io has no extension market: the reason');
    const { install, npm } = await installer({
      latest: vi.fn(async () => null),
      down: () => reason,
    });
    const err = await install({ id: 'probe' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code, status: 502 });
    expect((err as Error).message).toBe(
      'probe: agentage.io has no extension market: the reason; the daemon reads it when it starts: ' +
        'AGENTAGE_SITE_FQDN=<site> agentage daemon restart'
    );
    expect(npm).not.toHaveBeenCalled();
  });

  test('a failed npm install is INSTALL_FAILED 502 with the npm reason', async () => {
    const npm = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'npm error E500 boom' }));
    const m = market({ version: '0.2.0', package: PKG });
    const deps = { npm: async () => npm, manifest: manifestFromFixtures(), market: () => m };
    await expect(cliInstaller(deps)({ id: 'probe' })).rejects.toMatchObject({
      code: 'INSTALL_FAILED',
      status: 502,
      message: expect.stringContaining('E500 boom'),
    });
  });

  test('a version the 0.51 tree holds runs from there: no market, no npm (offline)', async ({
    dir,
  }) => {
    dir.tree('probe');
    const offline = await installer({
      latest: vi.fn(async () => null),
      down: () => new CliError('no_market', 'none'),
    });
    const got = await offline.install({ id: 'probe', version: '0.2.0' });
    expect(got.dir).toMatch(/extensions\/trees\/[^/]+\/node_modules\/@agentage\/fixture-probe$/);
    expect(offline.npm).not.toHaveBeenCalled();
  });
});
