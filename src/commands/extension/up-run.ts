import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { hostClient, type HostClient } from '../../lib/daemon/host-client.js';
import { setExit } from '../../lib/exit-code.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { installFolder } from './install-once.js';
import { loadKitTool } from './kit-tool.js';
import { buildPackage, npmIn, type Npm, type PackageBuild } from './package-build.js';
import { NEXT, seedNext, stagedBuild, stageOf, upModeOf, type UpMode } from './up-build.js';
import { refuseRunning, untilStopped, writeRecord } from './up-local.js';
import { coalesced, runRest, watchFolder, watchTsc, type Stoppable } from './up-watch.js';

export interface LocalUpDeps {
  build: (dir: string) => Promise<PackageBuild>;
  daemon: () => Promise<{ port: number; host: HostClient }>;
  npm: Npm;
  stopped: (dir: string) => Promise<string>;
}

export const localUpDeps: LocalUpDeps = {
  build: (dir) => buildPackage(dir),
  daemon: async () => {
    const port = await ensureDaemon();
    return { port, host: hostClient(port) };
  },
  npm: npmIn,
  stopped: (dir) => untilStopped(dir),
};

export interface LocalUp {
  id: string;
  version: string;
  url: string;
  port: number;
  added: boolean;
  stoppedBy: string;
}

interface Run {
  dir: string;
  id: string;
  host: HostClient;
  deps: LocalUpDeps;
}

const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path);

// Checked before the daemon starts: a folder that is no extension package starts nothing.
const idOf = (dir: string): string => {
  const file = join(dir, 'package.json');
  if (!existsSync(file))
    throw new CliError(
      'invalid_argument',
      `no package.json in ${dir}: run it in an extension package folder`
    );
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { agentage?: { id?: unknown } };
  const id = pkg.agentage?.id;
  if (typeof id !== 'string') throw new CliError('invalid_argument', `${dir}: no agentage.id`);
  return id;
};

// The daemon runs this folder already (a create or an earlier up): its live dist is not rebuilt.
const runsHere = async (host: HostClient, id: string, dir: string): Promise<boolean> =>
  (await host.list()).some((row) => row.id === id && real(row.source) === real(dir));

// Problems do not stop a local run; they are printed, as `extension build` would refuse them.
const warnProblems = async ({ report }: PackageBuild): Promise<void> => {
  if (report.conforms) return;
  for (const text of (await loadKitTool()).checkLines(report)) console.error(`check     ${text}`);
};

// One line per reload: reloaded and the time, or the daemon's refusal (the last good build runs).
export const reload = async ({ host, id }: Run, since: number): Promise<void> => {
  const answer = await host.reload(id).catch((err: unknown) => ({ error: messageOf(err) }));
  const ms = Date.now() - since;
  if ('error' in answer) return console.error(`reload    ${id} failed: ${answer.error}`);
  if (answer.reloaded) return console.log(`reload    ${id} reloaded: true in ${ms} ms`);
  console.log(
    `reload    ${id} reloaded: false, refused: ${answer.refused ?? 'no reason'} (${ms} ms)`
  );
  console.log(`          ${id} the last good build runs`);
};

// A build that fails prints the compiler's words (its own stderr) and sends no reload.
const stageAndReload = async (run: Run): Promise<void> => {
  const since = Date.now();
  try {
    await stagedBuild(run.dir, run.deps.npm);
  } catch (err) {
    return console.error(`build     failed, no reload: ${messageOf(err)}`);
  }
  await reload(run, since);
};

// D17: a change under src/ui runs the widget bundle into dist/ui; the daemon serves no ui yet.
const bundleUi = async (run: Run, rest: string): Promise<void> => {
  const since = Date.now();
  if (!(await runRest(run.dir, rest))) return console.error('ui        the bundle failed');
  cpSync(join(run.dir, 'dist', 'ui'), join(run.dir, NEXT, 'ui'), { recursive: true, force: true });
  console.log(`ui        bundled into dist/ui in ${Date.now() - since} ms (no reload)`);
};

const watchWithTsc = (run: Run, mode: Extract<UpMode, { kind: 'tsc' }>): Stoppable[] => {
  const tsc = watchTsc(run.dir, mode, ({ errors, ms, first }) => {
    if (errors > 0) return console.error(`build     ${errors} error(s), no reload`);
    if (!first) void reload(run, Date.now() - ms);
  });
  if (!mode.rest) return [tsc];
  const rest = mode.rest;
  const ui = watchFolder(
    join(run.dir, 'src', 'ui'),
    coalesced(() => bundleUi(run, rest))
  );
  return [tsc, ui];
};

const startWatch = (run: Run, mode: UpMode): Stoppable[] => {
  if (mode.kind === 'tsc') return watchWithTsc(run, mode);
  if (!mode.script) console.error('watch     no build script: a change in src/ is not built');
  if (!existsSync(join(run.dir, 'src')))
    console.error('watch     no src/ folder: nothing to watch');
  if (!mode.script) return [];
  return [
    watchFolder(
      join(run.dir, 'src'),
      coalesced(() => stageAndReload(run))
    ),
  ];
};

// Ready: the line, and with --json one JSON line on stdout before the envelope at exit.
const ready = (up: Omit<LocalUp, 'stoppedBy'>, json: boolean): void => {
  console.log(`up        ${up.id} ${up.version} on ${up.url} (watching src/; Ctrl-C stops)`);
  const line = { ready: true, id: up.id, version: up.version, url: up.url, port: up.port };
  if (json) process.stdout.write(`${JSON.stringify(line)}\n`);
};

const stopLine = (id: string, stoppedBy: string, added: boolean): void => {
  if (stoppedBy === 'down') return console.log(`stopped   watching ${id} (extension down)`);
  console.log(`stopped   watching ${id} (${stoppedBy}); the daemon still runs it`);
  if (added) console.log(`          agentage extension down removes it (its data stays)`);
};

// The first build: in the folder while no child runs it, else staged and reloaded.
const firstBuild = async (run: Run, mode: UpMode): Promise<void> => {
  if (!(await runsHere(run.host, run.id, run.dir))) {
    await warnProblems(await run.deps.build(run.dir));
    return seedNext(run.dir);
  }
  seedNext(run.dir);
  if (mode.kind === 'tsc' || mode.script) await stageAndReload(run);
};

// D12: build, the folder as a daemon row, a watch that builds to dist.next and reloads that child.
export const runLocalUp = async (
  folder = '.',
  deps = localUpDeps,
  json = false
): Promise<LocalUp> => {
  const dir = resolve(folder);
  const before = refuseRunning(dir);
  const id = idOf(dir);
  const { port, host } = await deps.daemon();
  const run: Run = { dir, id, host, deps };
  const mode = upModeOf(dir);
  // A stage of an earlier up may hold an old package.json: the first staged build copies it again.
  rmSync(stageOf(dir), { recursive: true, force: true });
  await firstBuild(run, mode);
  const { row, already } = await installFolder(host, dir);
  const added = !already || before?.added === true;
  writeRecord(dir, { pid: process.pid, id: row.id, added });
  const url = `http://127.0.0.1:${port}/api/${row.id}/`;
  ready({ id: row.id, version: row.version, url, port, added }, json);
  const watchers = startWatch(run, mode);
  const stoppedBy = await deps.stopped(dir);
  for (const watcher of watchers) watcher.stop();
  stopLine(row.id, stoppedBy, added);
  if (stoppedBy === 'SIGINT') setExit(130);
  return { id: row.id, version: row.version, url, port, added, stoppedBy };
};
