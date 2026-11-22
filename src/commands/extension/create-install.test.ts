import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { fakeHost } from '../../test/host.js';
import { installCreated, trustFrom, type CreateInstallDeps } from './create-install.js';
import { buildPackage, newerKitLine } from './package-build.js';
import { childEnv } from '../../lib/child-env.js';
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
    expect(npm).toHaveBeenCalledWith(dir.at('demo'), [
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
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

  test('--no-install only scaffolds: no npm, no build; the daemon off builds and installs nothing', async ({
    dir,
  }) => {
    const { all, daemon, npm } = deps();
    const build = vi.spyOn(all, 'build');
    expect(await installCreated(dir.at('demo'), false, all)).toEqual({
      installed: null,
      url: null,
    });
    expect(npm).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
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

const io = (isTTY: boolean, answer = '') => {
  const asked: string[] = [];
  return { asked, io: { isTTY, prompt: async (q: string) => (asked.push(q), answer) } };
};

describe('extension create --from another repo or a branch', () => {
  const NOTICE = (from: string) =>
    `template  ${from}: code from that repo will be built and run on this machine`;

  test.for(['agentage/platform:template', 'agentage/kit:template', 'agentage/extension-template'])(
    'the template itself asks nothing: %s',
    async (from) => {
      const quiet = await output(() => trustFrom(from, {}, io(false).io));
      expect(quiet).toMatchObject({ error: null, stderr: '' });
    }
  );

  test.for(['acme/ext', 'agentage/extension-template#feature/x', 'agentage/platform:packages'])(
    '%s with no terminal needs --yes, --no-install or not',
    async (from) => {
      const refused = await output(() => trustFrom(from, {}, io(false).io));
      expect(refused).toMatchObject({
        code: 'invalid_argument',
        error: `--from ${from} with no terminal: pass --yes to run it`,
        stderr: NOTICE(from),
      });
      expect((await output(() => trustFrom(from, { yes: true }, io(false).io))).error).toBeNull();
    }
  );

  test('on a terminal it asks y/N: y goes on, anything else creates nothing; --yes asks nothing', async () => {
    const yes = io(true, 'y');
    expect((await output(() => trustFrom('acme/ext', {}, yes.io))).error).toBeNull();
    expect(yes.asked).toEqual(['run it? (y/N) ']);
    const no = await output(() => trustFrom('acme/ext', {}, io(true, '').io));
    expect(no).toMatchObject({
      code: 'cancelled',
      error: '--from acme/ext: not confirmed, nothing created',
    });
    const skipped = io(true, 'n');
    expect((await output(() => trustFrom('acme/ext', { yes: true }, skipped.io))).error).toBeNull();
    expect(skipped.asked).toEqual([]);
  });
});

describe('a package on a newer kit than this cli bundles', () => {
  test('create fails naming the cause and the command: update the cli', async ({ dir }) => {
    dir.write('demo/package.json', { name: 'demo', engines: { agentage: '^99.1.0' } });
    const { all } = deps(false);
    const run = await output(() => installCreated(dir.at('demo'), true, all));
    expect(run).toMatchObject({ code: 'not_conforming' });
    expect(run.error).toMatch(
      /this cli bundles kit \d+\.\d+\.\d+, the package needs kit \^99\.1\.0: update the cli \(agentage update\)/
    );
  });

  test('a package on this kit or an older one keeps the check line', async ({ dir }) => {
    dir.write('demo/package.json', { name: 'demo', engines: { agentage: '^0.12.0' } });
    expect(newerKitLine(dir.at('demo'))).toBeNull();
    expect(newerKitLine(dir.at('none'))).toBeNull();
  });
});
