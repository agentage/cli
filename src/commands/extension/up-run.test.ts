import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { nextFreePort, readRecord, recordPath, stopLocal, writeRecord } from './up-local.js';
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
  return { deps, stop };
};

const until = async <T>(read: () => T | null): Promise<T> => {
  for (let i = 0; i < 200; i += 1) {
    const value = read();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('timed out');
};

describe('extension up with no Docker: the kit host in this process', () => {
  test('serves /health and the api on the next free port from 4244, until stopped', async ({
    dir,
  }) => {
    const demo = folder(dir.at(''));
    const { deps, stop } = controlled();
    const expected = await nextFreePort();
    const run = output(() => runLocalUp(demo, deps));
    const record = await until(() => readRecord(demo));
    expect(record).toMatchObject({ pid: process.pid, port: expected, id: 'demo' });
    const at = `http://127.0.0.1:${record.port}`;
    expect((await fetch(`${at}/health`)).status).toBe(200);
    expect(await (await fetch(`${at}/api/demo/echo`)).json()).toMatchObject({ success: true });
    const again = await output(() => runLocalUp(demo, deps));
    expect(again).toMatchObject({ code: 'already_running' });
    stop('SIGINT');
    const done = await run;
    expect(done.lines).toEqual([
      `up        demo 0.1.0 on ${at}/api/demo/ (Ctrl-C stops it)`,
      'stopped   demo (SIGINT)',
    ]);
    expect(done.stderr).toContain('check     ');
    expect(readRecord(demo)).toBeNull();
    await expect(fetch(`${at}/health`)).rejects.toThrow();
  });

  test('skips a port that is taken', async () => {
    const first = await nextFreePort();
    const held = createServer().listen(first, '127.0.0.1');
    await new Promise((done) => held.once('listening', done));
    expect(await nextFreePort()).toBeGreaterThan(first);
    held.close();
  });
});

const HEALTH = `require('node:http').createServer((q, s) => s.end(JSON.stringify({ data: { extension: 'demo', instance: 'abc' } }))).listen(+process.argv[1], '127.0.0.1', () => console.log('ready'));`;

describe('extension down: the local run of this folder', () => {
  test('signals the recorded pid only when its port answers as that extension', async ({ dir }) => {
    const demo = dir.at('ext');
    mkdirSync(demo, { recursive: true });
    const port = await nextFreePort(4300);
    const child = spawn(process.execPath, ['-e', HEALTH, String(port)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise((done) => child.stdout.once('data', done));
    const exited = new Promise((done) => child.once('exit', done));
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

  test('a record whose port refuses is stale and goes; no record is none', async ({ dir }) => {
    const demo = dir.at('ext');
    writeRecord(demo, { pid: 1, port: await nextFreePort(4400), id: 'demo', instance: 'x' });
    expect(await stopLocal(demo)).toBe('stale');
    expect(dir.exists('ext/.agentage/up.json')).toBe(false);
    expect(await stopLocal(demo)).toBe('none');
    expect(recordPath(demo)).toBe(join(demo, '.agentage', 'up.json'));
  });
});
