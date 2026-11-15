import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { takeExit } from '../../lib/exit-code.js';
import { type KitTool } from './kit-tool.js';
import { runExtensionDown } from './up.js';
import { listenFrom, portOf, readRecord, recordPath, stopLocal, writeRecord } from './up-local.js';
import { localUpDeps, runLocalUp, type LocalUpDeps } from './up-run.js';

const API = `export const create = () => (req, res) =>
  res.status(200).json({ success: true, data: { path: req.url } });
`;

// A built package with an api part and no build script, as the e2e fixture is.
const folder = (root: string): string => {
  const dir = join(root, 'extension-demo');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(dir, 'dist', 'api'), { recursive: true });
  const parts = { api: true };
  const pkg = {
    name: '@agentage/extension-demo',
    version: '0.1.0',
    type: 'module',
    engines: { node: '>=22', agentage: '>=0.12' },
  };
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ ...pkg, agentage: { id: 'demo', parts } })
  );
  writeFileSync(
    join(dir, 'dist', 'agentage-extension.json'),
    JSON.stringify({ id: 'demo', parts: { api: {} } })
  );
  writeFileSync(join(dir, 'dist', 'api', 'index.js'), API);
  return dir;
};

const notConforming = {
  id: 'demo',
  version: '0.1.0',
  conforms: false,
  rules: ['surface'],
  problems: [{ rule: 'surface', problem: 'openapi.json is missing' }],
  skipped: {},
};

// The run stops when the test says so, as Ctrl-C would.
const controlled = () => {
  let stop: (signal: string) => void = () => undefined;
  const stopped = new Promise<string>((done) => (stop = done));
  const deps: LocalUpDeps = {
    ...localUpDeps,
    build: async (dir) => ({ dir, built: false, contracts: [], report: notConforming }),
    stopped: () => stopped,
  };
  return { deps, stop, stopped };
};

const until = async <T>(read: () => T | null): Promise<T> => {
  for (let i = 0; i < 200; i += 1) {
    const value = read();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('timed out');
};

// The first port from `from` that binds, released again.
const freeFrom = async (from = 4244): Promise<number> => {
  const server = await listenFrom(() => undefined, from);
  const port = portOf(server);
  await new Promise((done) => server.close(done));
  return port;
};

const started = async (demo: string, deps: LocalUpDeps) => {
  const run = output(() => runLocalUp(demo, deps));
  const record = await until(() => readRecord(demo));
  return { run, record, at: `http://127.0.0.1:${record.port}` };
};

describe('extension up with no Docker: the kit host in this process', () => {
  test('serves /health and the api on the next free port from 4244; Ctrl-C exits 130', async ({
    dir,
  }) => {
    const demo = folder(dir.at(''));
    const { deps, stop } = controlled();
    const expected = await freeFrom();
    const { run, record, at } = await started(demo, deps);
    expect(record).toMatchObject({ pid: process.pid, port: expected, id: 'demo' });
    expect((await fetch(`${at}/health`)).status).toBe(200);
    expect(await (await fetch(`${at}/api/demo/echo`)).json()).toMatchObject({ success: true });
    expect(readFileSync(join(demo, '.gitignore'), 'utf8')).toBe('.agentage/\n');
    stop('SIGINT');
    const done = await run;
    expect(done.lines).toEqual([
      `up        demo 0.1.0 on ${at}/api/demo/ (Ctrl-C stops it)`,
      'stopped   demo (SIGINT)',
    ]);
    expect(done.stderr).toContain('check     ');
    expect(takeExit()).toBe(130);
    expect(readRecord(demo)).toBeNull();
    await expect(fetch(`${at}/health`)).rejects.toThrow();
  });

  test('a second up of the same folder while the first answers: already_running; SIGTERM exits 0', async ({
    dir,
  }) => {
    const demo = folder(dir.at(''));
    const { deps, stop } = controlled();
    const { run, at } = await started(demo, deps);
    const again = await output(() => runLocalUp(demo, deps));
    expect(again).toMatchObject({ code: 'already_running' });
    expect(again.error).toBe(`extension up runs for ${demo} on ${at}: extension down`);
    stop('SIGTERM');
    await run;
    expect(takeExit()).toBeNull();
  });

  test('refuses another site: a foreign Host, a cross-site fetch, a foreign Origin', async ({
    dir,
  }) => {
    const demo = folder(dir.at(''));
    const { deps, stop } = controlled();
    const { run, record, at } = await started(demo, deps);
    const local = { host: `localhost:${record.port}` };
    for (const headers of [
      { host: 'evil.example' },
      { ...local, 'sec-fetch-site': 'cross-site' },
      { ...local, origin: 'http://evil.example' },
    ]) {
      const res = await rawGet(record.port, headers);
      expect(res, JSON.stringify(headers)).toBe(403);
    }
    expect(await rawGet(record.port, { ...local, origin: `http://${local.host}` })).toBe(200);
    expect((await fetch(`${at}/health`)).status).toBe(200);
    stop('SIGTERM');
    await run;
  });

  test("mounts the kit's own guard when the kit exports one, and not the cli's", async ({
    dir,
  }) => {
    const demo = folder(dir.at(''));
    const { deps, stop } = controlled();
    const real = await deps.kit();
    const seen: number[] = [];
    const guard = (port: () => number) => (_q: unknown, _s: unknown, next: () => void) => {
      seen.push(port());
      next();
    };
    const { run, record } = await started(demo, { ...deps, kit: async () => ({ ...real, guard }) });
    expect(await rawGet(record.port, { host: 'evil.example' })).toBe(200);
    expect(seen).toContain(record.port);
    stop('SIGTERM');
    await run;
  });

  test('stops the host and leaves no record when the run fails after it started', async ({
    dir,
  }) => {
    const demo = folder(dir.at(''));
    const { deps } = controlled();
    const real = await deps.kit();
    const stops = vi.fn();
    const host: typeof real.host = async (at, opts) => {
      const hosted = await real.host(at, opts);
      return { ...hosted, stop: () => (stops(), hosted.stop()) };
    };
    const failing = {
      ...deps,
      kit: async () => ({ ...real, host }),
      stopped: async () => {
        throw new Error('boom');
      },
    };
    expect((await output(() => runLocalUp(demo, failing))).error).toBe('boom');
    expect(stops).toHaveBeenCalledTimes(1);
    expect(readRecord(demo)).toBeNull();
  });

  test('--json: one JSON line with the URL on stdout when the host is ready', async ({ dir }) => {
    const demo = folder(dir.at(''));
    const { deps, stop } = controlled();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const run = output(() => runLocalUp(demo, deps, true));
    const record = await until(() => readRecord(demo));
    const url = `http://127.0.0.1:${record.port}/api/demo/`;
    await until(() => write.mock.calls.length > 0 || null);
    const line = { ready: true, id: 'demo', version: '0.1.0', url, port: record.port };
    expect(write.mock.calls).toEqual([[`${JSON.stringify(line)}\n`]]);
    write.mockRestore();
    stop('SIGTERM');
    await run;
  });

  test('skips a port that is taken', async () => {
    const first = await freeFrom();
    const held = createServer().listen(first, '127.0.0.1');
    await new Promise((done) => held.once('listening', done));
    expect(await freeFrom()).toBeGreaterThan(first);
    held.close();
  });
});

const rawGet = (port: number, headers: Record<string, string>): Promise<number> =>
  new Promise((done, fail) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/health', headers, agent: false },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      }
    );
    req.once('error', fail).end();
  });

const HEALTH = `require('node:http').createServer((q, s) => s.end(JSON.stringify({ data: { extension: 'demo', instance: 'abc' } }))).listen(+process.argv[1], '127.0.0.1', () => console.log('ready'));`;

// A process that answers /health as the recorded run and exits on SIGTERM.
const fakeRun = async (port: number) => {
  const child = spawn(process.execPath, ['-e', HEALTH, String(port)], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((done) => child.stdout.once('data', done));
  return { child, exited: new Promise((done) => child.once('exit', done)) };
};

describe('extension down: the local run of this folder', () => {
  test('signals the recorded pid only when its port answers as that extension', async ({ dir }) => {
    const demo = dir.at('ext');
    mkdirSync(demo, { recursive: true });
    const port = await freeFrom(4300);
    const { child, exited } = await fakeRun(port);
    writeRecord(demo, { pid: child.pid ?? 0, port, id: 'demo', instance: 'other' });
    const kill = vi.spyOn(process, 'kill');
    expect(await stopLocal(demo)).toBe('stale');
    expect(kill).not.toHaveBeenCalled();
    writeRecord(demo, { pid: child.pid ?? 0, port, id: 'demo', instance: 'abc' });
    expect(await stopLocal(demo)).toBe('stopped');
    expect(kill).toHaveBeenCalledWith(child.pid, 'SIGTERM');
    await exited;
    kill.mockRestore();
  });

  test('a local run and a Docker stack in one folder: both stop, the local one first', async ({
    dir,
  }) => {
    const demo = dir.at('ext');
    dir.write('ext/.agentage/compose.json', { name: 'agentage-ext' });
    const port = await freeFrom(4320);
    const { child, exited } = await fakeRun(port);
    writeRecord(demo, { pid: child.pid ?? 0, port, id: 'demo', instance: 'abc' });
    const asked: unknown[] = [];
    const tool = async () =>
      ({
        down: async (opts: { onLine: (line: string) => void }) => {
          asked.push(opts);
          opts.onLine('removed  2 containers');
        },
      }) as unknown as KitTool;
    const run = await output(() => runExtensionDown({ dir: demo }, tool));
    expect(run.lines).toEqual(['stopped   extension up in this folder', 'removed  2 containers']);
    expect(asked).toHaveLength(1);
    await exited;
  });

  test('a signal that fails is stop_failed, with the reason', async ({ dir }) => {
    const demo = dir.at('ext');
    mkdirSync(demo, { recursive: true });
    const port = await freeFrom(4340);
    const { child, exited } = await fakeRun(port);
    writeRecord(demo, { pid: child.pid ?? 0, port, id: 'demo', instance: 'abc' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    });
    await expect(stopLocal(demo)).rejects.toMatchObject({
      code: 'stop_failed',
      message: `cannot stop extension up (pid ${child.pid}): kill EPERM`,
    });
    kill.mockRestore();
    child.kill();
    await exited;
  });

  test('a record whose port refuses is stale and goes; no record is none', async ({ dir }) => {
    const demo = dir.at('ext');
    writeRecord(demo, { pid: 1, port: await freeFrom(4400), id: 'demo', instance: 'x' });
    expect(await stopLocal(demo)).toBe('stale');
    expect(dir.exists('ext/.agentage/up.json')).toBe(false);
    expect(await stopLocal(demo)).toBe('none');
    expect(recordPath(demo)).toBe(join(demo, '.agentage', 'up.json'));
  });
});
