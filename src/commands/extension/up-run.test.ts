import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { takeExit } from '../../lib/exit-code.js';
import { type HostReload, type HostRow } from '../../lib/daemon/host-client.js';
import { output, test, type ConfigDir } from '../../test/config-dir.js';
import { fakeHost } from '../../test/host.js';
import { type Npm, type PackageBuild } from './package-build.js';
import { readRecord, removeRecord, writeRecord } from './up-local.js';
import { prepareStage, stageOf } from './up-build.js';
import { runLocalUp, type LocalUpDeps } from './up-run.js';
import { markOf } from '../../lib/proc/start-time.js';
import { ENDED, rec } from '../../test/up-record.js';
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

// A working copy whose build is plain tsc, with typescript/bin/tsc a stand-in script.
const tscCopy = (dir: Dir, tsc: string): string => {
  const folder = workingCopy(dir);
  dir.write('demo/package.json', { ...PKG, scripts: { build: 'tsc -p tsconfig.build.json' } });
  dir.write('demo/node_modules/typescript/package.json', { name: 'typescript', version: '6.0.0' });
  dir.write('demo/node_modules/typescript/bin/tsc', tsc);
  return folder;
};

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
    expect(readRecord(folder)).toMatchObject({ up: markOf(process.pid), id: 'demo', added: true });
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
    expect(runs).toEqual([stageOf(folder)]);
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
    writeRecord(folder, rec(ENDED, false));
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
    writeRecord(folder, rec(ENDED, true));
    const down = await output(() =>
      runExtensionDown({ dir: folder }, undefined, async () => fake.host)
    );
    expect(fake.host.remove).toHaveBeenCalledWith('demo', false);
    expect(down.lines.at(-1)).toBe('removed   demo from the daemon (its data stays)');
    const other = fakeHost([folderRow(dir.at('elsewhere'))]);
    writeRecord(folder, rec(ENDED, true));
    await output(() => runExtensionDown({ dir: folder }, undefined, async () => other.host));
    expect(other.host.remove).not.toHaveBeenCalled();
  });
});

describe('how an up ends', () => {
  test('down after a killed up removes its stage from the config cache', async ({ dir }) => {
    const folder = workingCopy(dir);
    dir.write('demo/node_modules/m/index.js', '');
    prepareStage(folder);
    writeRecord(folder, rec(ENDED, false));
    await output(() => runExtensionDown({ dir: folder }, undefined, async () => fakeHost().host));
    expect(existsSync(stageOf(folder))).toBe(false);
    expect(existsSync(join(folder, 'node_modules/m/index.js'))).toBe(true);
  });

  test('down removes the row up added even when that up does not stop', async ({ dir }) => {
    const folder = workingCopy(dir);
    const { fake } = depsOf([folderRow(folder)], async () => 'SIGTERM', stageNpm().npm);
    writeRecord(folder, rec(process.ppid, true));
    const down = await output(() =>
      runExtensionDown({ dir: folder }, undefined, async () => fake.host, 200)
    );
    expect(down.error).toMatch(/did not stop/);
    expect(fake.host.remove).toHaveBeenCalledWith('demo', false);
  });

  test('a tsc folder: the first build is not reloaded, a later clean one is, an error is not', async ({
    dir,
  }) => {
    const folder = tscCopy(dir, FAKE_TSC);
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
    expect(readRecord(folder)?.tsc?.pid).toEqual(expect.any(Number));
  });

  test('a tsc watch that dies stops up with one line and fails (build_failed, exit 1)', async ({
    dir,
  }) => {
    const folder = tscCopy(dir, 'process.exit(4);');
    const { deps } = depsOf([], (_dir, _nonce, ended) => ended, stageNpm().npm);
    const run = await output(() => runLocalUp(folder, deps));
    expect(run.stderr).toContain('watch     tsc exited 4; extension up stops (run it again)');
    expect(run).toMatchObject({
      code: 'build_failed',
      error: 'extension up stopped: tsc exited 4',
    });
    expect(takeExit()).toBeNull();
  });

  test('reload calls that keep failing stop up as daemon_unavailable', async ({ dir }) => {
    const folder = workingCopy(dir);
    const { deps, fake } = depsOf([folderRow(folder)], (_d, _n, ended) => ended, stageNpm().npm);
    vi.mocked(fake.host.reload).mockRejectedValue(new Error('the daemon on 127.0.0.1:1: reset'));
    const up = output(() => runLocalUp(folder, deps));
    for (let i = 0; i < 3; i += 1) {
      await vi.waitFor(() => expect(fake.host.reload).toHaveBeenCalledTimes(i + 1));
      writeFileSync(join(folder, 'src/api/index.js'), `change ${i}`);
    }
    expect(await up).toMatchObject({
      code: 'daemon_unavailable',
      error: 'extension up stopped: the reload failed 3 times in a row',
    });
  });

  test('a second up whose build tool is missing stops at the first build (build_failed)', async ({
    dir,
  }) => {
    const folder = workingCopy(dir);
    const missing: Npm = async (cwd) => {
      throw new Error(`npm run build in ${cwd} exited 127`);
    };
    const { deps, fake } = depsOf([folderRow(folder)], async () => 'SIGINT', missing);
    const run = await output(() => runLocalUp(folder, deps));
    expect(run).toMatchObject({
      code: 'build_failed',
      error: 'extension up stopped: the build tool is missing (npm ci installs it)',
    });
    expect(fake.host.reload).not.toHaveBeenCalled();
    expect(readRecord(folder)?.added).toBe(false);
  });

  test('a folder that is no extension package starts nothing (invalid_argument)', async ({
    dir,
  }) => {
    const { deps, fake } = depsOf([], async () => 'SIGINT', stageNpm().npm);
    dir.write('plain/package.json', { name: 'plain' });
    const noId = await output(() => runLocalUp(dir.at('plain'), deps));
    expect(noId).toMatchObject({
      code: 'invalid_argument',
      error: `${dir.at('plain')}: no agentage.id`,
    });
    const none = await output(() => runLocalUp(dir.at('none'), deps));
    expect(none.error).toMatch(/^no package\.json in .*: run it in an extension package folder$/);
    expect(fake.host.add).not.toHaveBeenCalled();
  });

  test('a closed terminal (SIGHUP) stops the watch, keeps the row, exits 129', async ({ dir }) => {
    const folder = workingCopy(dir);
    const { deps, fake } = depsOf([], async () => 'SIGHUP', stageNpm().npm);
    const run = await output(() => runLocalUp(folder, deps));
    expect(run.lines.at(-2)).toBe('stopped   watching demo (SIGHUP); the daemon still runs it');
    expect(fake.host.remove).not.toHaveBeenCalled();
    expect(takeExit()).toBe(129);
  });

  test('down during the start stops up (cancelled) and the tsc watch it started', async ({
    dir,
  }) => {
    const pidFile = dir.at('tsc.pid');
    const tsc = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);`;
    const folder = tscCopy(dir, tsc);
    const made = depsOf([], async () => 'SIGINT', stageNpm().npm);
    const build = made.deps.build;
    made.deps.build = async (at) => (removeRecord(at), build(at));
    const run = await output(() => runLocalUp(folder, made.deps));
    expect(run).toMatchObject({ code: 'cancelled' });
    expect(run.error).toMatch(/^extension down ran for .* while up started/);
    // A tsc left running writes its pid within the wait; a stopped one is gone or never wrote it.
    await new Promise((done) => setTimeout(done, 1_500));
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null;
    expect(pid === null || markOf(pid) === null).toBe(true);
  });
});
