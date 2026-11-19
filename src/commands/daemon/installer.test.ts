import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import {
  manifestFromFixtures,
  npmFromFixtures,
  npmPublishing,
  type Publishes,
} from '../../test/npm-fixtures.js';
import { type NpmManifest } from '../../core/installer/npm.js';
import { CliError } from '../../lib/json-output.js';
import { openMarket, type Market } from '../../lib/net/market.js';
import { cliInstaller, distTagOf } from './installer.js';

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

// npm's answer to `npm pack <name>@broken --dry-run --json`: the tag names one version.
const tagging = (tags: Record<string, string>) => async (): Promise<NpmManifest> => {
  const fixtures = await manifestFromFixtures()();
  return async (command, spec, registries) => {
    const at = spec.lastIndexOf('@');
    const version = tags[spec.slice(at + 1)];
    if (command !== 'pack' || !version) return fixtures(command, spec, registries);
    const stdout = JSON.stringify([{ name: spec.slice(0, at), version }]);
    return { code: 0, stdout, stderr: '' };
  };
};

describe('a dist-tag (fixture@broken), resolved as npm does', () => {
  test('a word that is not a range is a tag; a version or a range is not', () => {
    expect(distTagOf('@agentage/extension-fixture@broken')).toEqual({
      name: '@agentage/extension-fixture',
      tag: 'broken',
    });
    for (const spec of ['probe@0.7.0', 'probe@^0.7', 'probe@1.x', 'probe', '@agentage/x'])
      expect(distTagOf(spec), spec).toBeNull();
  });

  test('with a market only the scoped name is asked; the tag gives its version; no such tag is 404', async ({
    dir,
  }) => {
    const npm = vi.fn(await npmFromFixtures());
    const manifest = vi.fn(tagging({ broken: '0.2.0' }));
    const m = market({ version: '0.2.0', package: PKG });
    const install = cliInstaller({ npm: async () => npm, manifest, market: () => m });
    expect(await install({ id: 'probe', version: 'broken' })).toEqual({
      id: 'probe',
      version: '0.2.0',
      dir: dir.at(`extensions/packages/trees/probe@0.2.0/node_modules/${PKG}`),
    });
    await expect(install({ id: 'probe', version: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

// Every `npm pack <spec>` asked, each absent (E404): what was asked is the assertion.
const asking = () => {
  const asked: string[] = [];
  const manifest = async (): Promise<NpmManifest> => async (command, spec) => {
    asked.push(`${command} ${spec}`);
    return { code: 1, stdout: '', stderr: 'npm error code E404' };
  };
  return { asked, manifest };
};

describe('a dist-tag: which names are asked, and what is refused before npm', () => {
  test('on a site with no market both npm names are asked; with a market only the scoped one', async () => {
    const none = asking();
    const npm = vi.fn(await npmFromFixtures());
    const noMarket = {
      latest: vi.fn(async () => null),
      down: () => new CliError('no_market', 'x'),
    };
    const bare = cliInstaller({
      npm: async () => npm,
      manifest: none.manifest,
      market: () => noMarket,
    });
    await output(async () => {
      await expect(bare({ id: 'probe', version: 'broken' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
    expect(none.asked.map((a) => a.replace(/^\w+ /, ''))).toEqual([
      '@agentage/extension-probe@broken',
      'agentage-extension-probe@broken',
    ]);
    const some = asking();
    const m = market({ version: '0.2.0', package: '@agentage/extension-probe' });
    const scoped = cliInstaller({ npm: async () => npm, manifest: some.manifest, market: () => m });
    await expect(scoped({ id: 'probe', version: 'broken' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(some.asked.map((a) => a.replace(/^\w+ /, ''))).toEqual([
      '@agentage/extension-probe@broken',
    ]);
  });

  test('a path, file:, git+, a URL, a space or a flag after @ is refused; npm is never asked', async () => {
    const none = asking();
    const npm = vi.fn(await npmFromFixtures());
    const m = market({ version: '0.2.0', package: PKG });
    const install = cliInstaller({
      npm: async () => npm,
      manifest: none.manifest,
      market: () => m,
    });
    for (const version of [
      '../x',
      'file:../x',
      'git+ssh://h/r.git',
      'http://h/x.tgz',
      'a b',
      '--registry=x',
    ])
      await expect(install({ id: 'probe', version }), version).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    expect(none.asked).toEqual([]);
    expect(npm).not.toHaveBeenCalled();
    expect(m.latest).not.toHaveBeenCalled();
  });
});

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

  test('a refused market answer is MARKET_FAILED 502, also with a version; npm is never asked', async () => {
    const refused = new CliError('market_failed', 'market answer refused for probe: version "*"');
    const m: Market = { latest: vi.fn(async () => Promise.reject(refused)), down: () => null };
    const { install, npm } = await installer(m);
    for (const version of [undefined, '0.2.0'])
      await expect(install({ id: 'probe', version })).rejects.toMatchObject({
        code: 'MARKET_FAILED',
        status: 502,
        message: `probe: ${refused.message}`,
      });
    expect(npm).not.toHaveBeenCalled();
  });

  test('a version npm does not have, or an id nobody has, is NOT_FOUND 404', async () => {
    const { install } = await installer(market({ version: '9.9.9', package: PKG }));
    await expect(install({ id: 'probe' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    const none = await installer(market(null));
    const run = await output(async () => {
      await expect(none.install({ id: 'nosuch' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    expect(run.stderr).toBe(
      'the market of agentage.io has no nosuch; nosuch resolves from npm as @agentage/extension-nosuch'
    );
  });

  test('a market without the id: npm is asked only for the scoped name, never the unscoped one', async () => {
    const asked: string[] = [];
    const base = manifestFromFixtures({
      'agentage-extension-nosuch': { '1.0.0': probeAt('^0.12') },
    });
    const manifest = async (): Promise<NpmManifest> => {
      const real = await base();
      return (command, spec, registries) => (asked.push(spec), real(command, spec, registries));
    };
    const npm = vi.fn(await npmFromFixtures());
    const install = cliInstaller({ npm: async () => npm, manifest, market: () => market(null) });
    await output(async () => {
      await expect(install({ id: 'nosuch' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((spec) => !spec.startsWith('@agentage/extension-nosuch'))).toEqual([]);
  });

  test.each([
    ['market_unreachable', 'MARKET_UNREACHABLE'],
    ['market_failed', 'MARKET_FAILED'],
    ['market_timeout', 'MARKET_TIMEOUT'],
  ] as const)(
    'a market that fails with %s, no version given: %s 502, no npm',
    async (why, code) => {
      const reason = new CliError(why, 'agentage.io market: the reason');
      const { install, npm } = await installer({
        latest: vi.fn(async () => null),
        down: () => reason,
      });
      const err = await install({ id: 'probe' }).catch((e: unknown) => e);
      expect(err).toMatchObject({ code, status: 502 });
      expect((err as Error).message).toBe('probe: agentage.io market: the reason');
      expect(npm).not.toHaveBeenCalled();
    }
  );

  // 0.51: a site with no market resolves @agentage/extension-<id> on the configured registry.
  const EXT = '@agentage/extension-probe';
  const probeAt = (engine: string) => ({
    agentage: { id: 'probe', parts: { api: true, cli: { entry: './cli.js' } }, commands: [] },
    engines: { agentage: engine },
  });
  const onSite = async (answer: number, run: (fqdn: string) => Promise<void>) => {
    const site = createServer((_req, res) => res.writeHead(answer).end());
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    const fqdn = `127.0.0.1:${(site.address() as AddressInfo).port}`;
    vi.stubEnv('AGENTAGE_SITE_FQDN', fqdn);
    try {
      await run(fqdn);
    } finally {
      vi.unstubAllEnvs();
      site.close();
    }
  };
  const fromRegistry = async (fqdn: string, published: Publishes) => {
    const npm = vi.fn(await npmPublishing(published)());
    const manifest = manifestFromFixtures(published);
    return cliInstaller({ npm: async () => npm, manifest, market: () => openMarket(fqdn) });
  };

  test('a site with no discovery document: the newest fitting version npm has, one stderr line', async ({
    dir,
  }) => {
    await onSite(404, async (fqdn) => {
      const published = { [EXT]: { '0.3.0': probeAt('^0.12'), '0.4.0': probeAt('^9') } };
      const install = await fromRegistry(fqdn, published);
      let got: unknown;
      const run = await output(async () => {
        got = await install({ id: 'probe' });
      });
      expect(run.error).toBeNull();
      expect(got).toEqual({
        id: 'probe',
        version: '0.3.0',
        dir: dir.at(`extensions/packages/trees/probe@0.3.0/node_modules/${EXT}`),
      });
      expect(run.stderr).toBe(
        `${fqdn} has no extension market; probe resolves from npm, as cli 0.51 did`
      );
    });
  });

  test('a site whose discovery answers 500 stays an error: MARKET_FAILED 502, no npm', async () => {
    await onSite(500, async (fqdn) => {
      const install = await fromRegistry(fqdn, { [EXT]: { '0.3.0': probeAt('^0.12') } });
      await expect(install({ id: 'probe' })).rejects.toMatchObject({ status: 502 });
    });
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
