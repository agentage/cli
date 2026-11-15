import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { fakeHost } from '../../test/host.js';
import { installCreated, type CreateInstallDeps } from './create-install.js';
import { buildPackage, childEnv } from './package-build.js';
import { type KitTool } from './kit-tool.js';

const report = (conforms: boolean) => ({
  id: 'demo',
  version: '0.1.0',
  conforms,
  rules: [],
  problems: [],
  skipped: {},
});

const OPENAPI = {
  paths: {
    '/api/demo/echo': { get: { security: [{ pat: ['demo:read'] }] } },
    '/api/demo/find': { get: { security: [], parameters: [{ name: 'q', required: true }] } },
    '/api/demo/ping': { get: { security: [] } },
    '/api/demo/pong': { get: {} },
  },
};

const deps = (conforms = true, answers = [404, 200]) => {
  const npm = vi.fn(async () => undefined);
  const daemon = fakeHost();
  const status = [...answers];
  const fetcher = vi.fn(
    async (_url: string) => new Response('', { status: status.shift() ?? 404 })
  );
  const all: CreateInstallDeps = {
    npm,
    build: async (dir) => ({ dir, built: true, contracts: [], report: report(conforms) }),
    daemon: async () => ({ port: 4555, host: daemon.host }),
    fetch: fetcher as unknown as typeof fetch,
    tool: async () =>
      ({
        checkLines: () => ['stack: kit 0.13.0 is outside engines.agentage ^0.12'],
      }) as unknown as KitTool,
  };
  return { all, npm, daemon, fetcher };
};

describe('extension create: npm ci, the build, then the daemon runs the folder', () => {
  test('installs by source and ends with the first public route that answers', async ({ dir }) => {
    dir.write('demo/openapi.json', OPENAPI);
    const { all, npm, daemon, fetcher } = deps();
    const run = await output(() => installCreated(dir.at('demo'), true, all));
    expect(npm).toHaveBeenCalledWith(dir.at('demo'), ['ci', '--no-audit', '--no-fund']);
    expect(daemon.host.add).toHaveBeenCalledWith({ source: dir.at('demo') });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:4555/api/demo/ping',
      'http://127.0.0.1:4555/api/demo/pong',
    ]);
    expect(run.lines).toEqual([
      'demo 0.1.0 running',
      ' url       http://127.0.0.1:4555/api/demo/pong',
    ]);
  });

  test('says so when no public route answers, or the package has none', async ({ dir }) => {
    dir.write('demo/openapi.json', OPENAPI);
    const { all } = deps(true, [404, 503]);
    const run = await output(() => installCreated(dir.at('demo'), true, all));
    expect(run.lines.at(-1)).toBe(' url       none answers yet: agentage extension list');
  });

  test('--no-install and the daemon off build and install nothing', async ({ dir }) => {
    const { all, daemon } = deps();
    expect(await installCreated(dir.at('demo'), false, all)).toEqual({
      installed: null,
      url: null,
    });
    vi.stubEnv('AGENTAGE_NO_DAEMON', '1');
    const run = await output(() => installCreated(dir.at('demo'), true, all));
    expect(run.lines).toEqual([
      ' install   the daemon is off (AGENTAGE_NO_DAEMON=1): not installed',
    ]);
    expect(daemon.host.add).not.toHaveBeenCalled();
  });

  test('a package that does not conform fails before the daemon is asked; the folder stays', async ({
    dir,
  }) => {
    const { all, daemon } = deps(false);
    const run = await output(() => installCreated(dir.at('demo'), true, all));
    expect(run).toMatchObject({ code: 'not_conforming' });
    expect(run.stderr).toContain('check     stack: kit 0.13.0 is outside engines.agentage ^0.12');
    expect(daemon.host.add).not.toHaveBeenCalled();
  });
});

describe('the package build', () => {
  test('runs the build script when there is one, writes the contracts, then checks', async ({
    dir,
  }) => {
    dir.write('a/package.json', { name: 'a', scripts: { build: 'tsc' } });
    dir.write('b/package.json', { name: 'b' });
    const npm = vi.fn(async () => undefined);
    const tool = async () =>
      ({
        writeContracts: async (at: string) => [`${at}/a.mcpc.json`],
        check: async () => report(true),
      }) as unknown as KitTool;
    const run = await output(() => buildPackage(dir.at('a'), { npm, tool }));
    expect(npm).toHaveBeenCalledWith(dir.at('a'), ['run', 'build']);
    expect(run.lines).toEqual([`wrote     ${dir.at('a')}/a.mcpc.json`]);
    expect(await buildPackage(dir.at('b'), { npm, tool })).toMatchObject({ built: false });
    expect(npm).toHaveBeenCalledTimes(1);
  });

  test("the cli's token never reaches the author's scripts", () => {
    expect(childEnv({ AGENTAGE_TOKEN: 't', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });
});
