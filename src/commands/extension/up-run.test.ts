import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { takeExit } from '../../lib/exit-code.js';
import { type HostReload, type HostRow } from '../../lib/daemon/host-client.js';
import { output, test, type ConfigDir } from '../../test/config-dir.js';
import { fakeHost } from '../../test/host.js';
import { type Npm, type PackageBuild } from './package-build.js';
import {
  readRecord,
  recordPath,
  refuseRunning,
  removeRecord,
  stopLocal,
  untilStopped,
  writeRecord,
} from './up-local.js';
import { runLocalUp, type LocalUpDeps } from './up-run.js';
import { runExtensionDown } from './up.js';

type Dir = ConfigDir;

const PKG = { name: '@agentage/extension-demo', version: '0.1.0', agentage: { id: 'demo' } };

// A plain-JS working copy as the e2e lab writes it: src/, a build script that is not tsc, dist/.
const workingCopy = (dir: Dir): string => {
  dir.write('demo/package.json', { ...PKG, scripts: { build: 'node build.mjs' } });
  dir.write('demo/src/api/index.js', 'one');
  dir.write('demo/dist/api/index.js', 'one');
  dir.write('demo/dist/agentage-extension.json', { id: 'demo' });
  return realpathSync(dir.at('demo'));
};

// The folder's tsc in watch mode: a first clean build, a change with an error, a clean one.
const FAKE_TSC = `#!/usr/bin/env node
console.log('Found 0 errors. Watching for file changes.');
setTimeout(() => {
  console.log('File change detected. Starting incremental compilation...');
  console.log('src/a.ts(1,1): error TS1005: x');
  console.log('Found 1 error. Watching for file changes.');
  console.log('Found 0 errors. Watching for file changes.');
}, 300);
setTimeout(() => {}, 10000);
`;

const REPORT = { conforms: true } as PackageBuild['report'];

// npm as a seam: `run build` in the stage copies its src/ to dist/, or fails as the build would.
const stageNpm = (fail = false): { npm: Npm; runs: string[] } => {
  const runs: string[] = [];
  const npm: Npm = async (cwd) => {
    runs.push(cwd);
    if (fail) throw new Error('npm run build exited 1');
    const text = readFileSync(join(cwd, 'src/api/index.js'), 'utf8');
    mkdirSync(join(cwd, 'dist/api'), { recursive: true });
    writeFileSync(join(cwd, 'dist/api/index.js'), text);
  };
  return { npm, runs };
};

const depsOf = (rows: HostRow[], stopped: LocalUpDeps['stopped'], npm: Npm) => {
  const fake = fakeHost(rows);
  const built: string[] = [];
  const deps: LocalUpDeps = {
    build: async (dir) => (built.push(dir), { dir, built: true, contracts: [], report: REPORT }),
    daemon: async () => ({ port: 4999, host: fake.host }),
    npm,
    stopped,
  };
  return { deps, built, fake };
};

const folderRow = (source: string): HostRow => ({
  id: 'demo',
  version: '0.1.0',
  source,
  state: 'running',
  enabled: true,
});

describe('extension up on the daemon (D12)', () => {
  test('a new folder: built in place, dist.next seeded from dist, added as a row; Ctrl-C leaves the row, exits 130', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    const { deps, built, fake } = depsOf([], async () => 'SIGINT', stageNpm().npm);
    const run = await output(() => runLocalUp(folder, deps));
    expect(built).toEqual([folder]);
    expect(fake.host.add).toHaveBeenCalledWith({ source: folder });
    expect(readFileSync(join(folder, 'dist.next/agentage-extension.json'), 'utf8')).toContain(
      'demo'
    );
    expect(readRecord(folder)).toEqual({ pid: process.pid, id: 'demo', added: true });
    expect(run.lines[0]).toBe(
      'up        demo 0.1.0 on http://127.0.0.1:4999/api/demo/ (watching src/; Ctrl-C stops)'
    );
    expect(run.lines.slice(-2)).toEqual([
      'stopped   watching demo (SIGINT); the daemon still runs it',
      '          agentage extension down removes it (its data stays)',
    ]);
    expect(takeExit()).toBe(130);
    expect(fake.rows.map((r) => r.id)).toEqual(['demo']);
  });

  test('a saved change in src/ builds in the stage, never in dist, and prints the reload line', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    const { npm, runs } = stageNpm();
    const made = depsOf(
      [],
      async () => {
        writeFileSync(join(folder, 'src/api/index.js'), 'two');
        await vi.waitFor(() => expect(made.fake.host.reload).toHaveBeenCalled(), {
          timeout: 5_000,
        });
        return 'down';
      },
      npm
    );
    const run = await output(() => runLocalUp(folder, made.deps));
    expect(runs).toEqual([join(folder, '.agentage/stage')]);
    expect(readFileSync(join(folder, 'dist.next/api/index.js'), 'utf8')).toBe('two');
    expect(readFileSync(join(folder, 'dist/api/index.js'), 'utf8')).toBe('one');
    expect(run.lines.find((l) => l.startsWith('reload'))).toMatch(
      /^reload {4}demo reloaded: true in \d+ ms$/
    );
    expect(run.lines.at(-1)).toBe('stopped   watching demo (extension down)');
  });

  test('a build that fails sends no reload; a refused reload names why, the last good build runs', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    const failing = depsOf(
      [],
      async () => {
        writeFileSync(join(folder, 'src/api/index.js'), 'bad');
        await new Promise((done) => setTimeout(done, 600));
        return 'SIGTERM';
      },
      stageNpm(true).npm
    );
    const bad = await output(() => runLocalUp(folder, failing.deps));
    expect(failing.fake.host.reload).not.toHaveBeenCalled();
    expect(bad.stderr).toContain('build     failed, no reload: npm run build exited 1');
    const refused: HostReload = { id: 'demo', version: '0.1.0', state: 'running', reloaded: false };
    const again = depsOf([folderRow(folder)], async () => 'SIGTERM', stageNpm().npm);
    vi.mocked(again.fake.host.reload).mockResolvedValue({ ...refused, refused: 'fails at start' });
    const run = await output(() => runLocalUp(folder, again.deps));
    expect(run.lines).toContainEqual(
      expect.stringMatching(/^reload {4}demo reloaded: false, refused: fails at start \(\d+ ms\)$/)
    );
    expect(run.lines).toContain('          demo the last good build runs');
  });

  test('a folder the daemon runs already: no build into its live dist, a staged build and a reload; down leaves that row', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    const { deps, built, fake } = depsOf(
      [folderRow(folder)],
      async () => 'SIGTERM',
      stageNpm().npm
    );
    await output(() => runLocalUp(folder, deps));
    expect(built).toEqual([]);
    expect(fake.host.reload).toHaveBeenCalledWith('demo');
    expect(readRecord(folder)).toMatchObject({ added: false });
    // That up has exited: its pid in the record is not alive any more.
    writeRecord(folder, { pid: 999_999_999, id: 'demo', added: false });
    const down = await output(() =>
      runExtensionDown({ dir: folder }, undefined, async () => fake.host)
    );
    expect(down.lines).toEqual(['removed   the record of an extension up that ended']);
    expect(fake.host.remove).not.toHaveBeenCalled();
  });

  test('down removes the row up added, with no purge; a row of that id from another folder stays', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    const { fake } = depsOf([folderRow(folder)], async () => 'SIGTERM', stageNpm().npm);
    writeRecord(folder, { pid: 999_999_999, id: 'demo', added: true });
    const down = await output(() =>
      runExtensionDown({ dir: folder }, undefined, async () => fake.host)
    );
    expect(fake.host.remove).toHaveBeenCalledWith('demo', false);
    expect(down.lines.at(-1)).toBe('removed   demo from the daemon (its data stays)');
    const other = fakeHost([folderRow(dir.at('elsewhere'))]);
    writeRecord(folder, { pid: 999_999_999, id: 'demo', added: true });
    await output(() => runExtensionDown({ dir: folder }, undefined, async () => other.host));
    expect(other.host.remove).not.toHaveBeenCalled();
  });
});

describe('the up record of a folder', () => {
  test('a live up of the folder is refused; one that ended keeps only its added', ({ dir }) => {
    dir.write('w/package.json', PKG);
    writeRecord(dir.at('w'), { pid: process.ppid, id: 'demo', added: true });
    expect(() => refuseRunning(dir.at('w'))).toThrow(
      /extension up runs for .* agentage extension down/
    );
    writeRecord(dir.at('w'), { pid: 999_999_999, id: 'demo', added: true });
    expect(refuseRunning(dir.at('w'))).toMatchObject({ added: true });
  });

  test('down removes the record and waits for that up to exit; one that does not is stop_failed', async ({
    dir,
  }) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)']);
    writeRecord(dir.at('w'), { pid: child.pid ?? 0, id: 'demo', added: false });
    expect((await stopLocal(dir.at('w'))).down).toBe('stopped');
    expect(dir.exists('w/.agentage/up.json')).toBe(false);
    expect((await stopLocal(dir.at('w'))).down).toBe('none');
    writeRecord(dir.at('w'), { pid: process.ppid, id: 'demo', added: false });
    await expect(stopLocal(dir.at('w'), 200)).rejects.toThrow(/did not stop/);
  });

  test('an up.json of another shape or not JSON reads as no record', ({ dir }) => {
    dir.write('w/.agentage/up.json', { pid: 0, id: 'demo', added: true });
    expect(readRecord(dir.at('w'))).toBeNull();
    writeFileSync(recordPath(dir.at('w')), 'not json');
    expect(readRecord(dir.at('w'))).toBeNull();
  });
});

describe('how an up ends', () => {
  test('down removes the record: up ends with down; a SIGTERM ends it too', async ({ dir }) => {
    writeRecord(dir.at('w'), { pid: process.pid, id: 'demo', added: true });
    const ended = untilStopped(dir.at('w'), 50);
    removeRecord(dir.at('w'));
    expect(await ended).toBe('down');
    writeRecord(dir.at('w'), { pid: process.pid, id: 'demo', added: true });
    const signalled = untilStopped(dir.at('w'), 50);
    process.emit('SIGTERM');
    expect(await signalled).toBe('SIGTERM');
  });

  test('a tsc folder: the first build is not reloaded, a later clean one is, an error is not', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    dir.write('demo/package.json', { ...PKG, scripts: { build: 'tsc -p tsconfig.build.json' } });
    dir.write('demo/node_modules/.bin/tsc', FAKE_TSC);
    chmodSync(join(folder, 'node_modules/.bin/tsc'), 0o755);
    const made = depsOf(
      [],
      async () => {
        await vi.waitFor(() => expect(made.fake.host.reload).toHaveBeenCalledOnce(), {
          timeout: 5_000,
        });
        return 'SIGTERM';
      },
      stageNpm().npm
    );
    const run = await output(() => runLocalUp(folder, made.deps));
    expect(run.stderr).toContain('build     1 error(s), no reload');
    expect(run.lines).toContainEqual(expect.stringMatching(/^reload {4}demo reloaded: true in/));
  });
});
