import { describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { manifestFromFixtures, npmFromFixtures } from '../../test/npm-fixtures.js';
import { type Market } from '../../lib/net/market.js';
import { cliInstaller } from './installer.js';

const PKG = '@agentage/fixture-probe';

const market = (latest: Awaited<ReturnType<Market['latest']>>): Market => ({
  latest: vi.fn(async () => latest),
  down: () => false,
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
    await expect(priv.install({ id: 'probe' })).rejects.toMatchObject({ code: 'private_entry' });
    const hello = await installer(market({ version: '1.0.0', package: '@agentage/fixture-hello' }));
    await expect(hello.install({ id: 'probe' })).rejects.toThrow('agentage.id is hello');
  });

  test('a version npm does not have is not_found', async () => {
    const { install } = await installer(market({ version: '9.9.9', package: PKG }));
    await expect(install({ id: 'probe' })).rejects.toThrow('No matching version');
  });
});
