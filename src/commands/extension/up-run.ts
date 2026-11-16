import { randomUUID } from 'node:crypto';
import { markOf, type ProcessMark } from '../../lib/proc/start-time.js';
import { resolve } from 'node:path';
import { isRecord } from '../../lib/fs/json-file.js';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { hostClient, type HostClient } from '../../lib/daemon/host-client.js';
import { setExit } from '../../lib/exit-code.js';
import { CliError } from '../../lib/json-output.js';
import { folderRow, installFolder } from './install-once.js';
import { loadKitTool } from './kit-tool.js';
import { buildPackage, npmIn, packageOf, type Npm, type PackageBuild } from './package-build.js';
import { removeStage, seedNext, upModeOf, type UpMode } from './up-build.js';
import { refuseRunning, untilStopped, writeRecord, type UpRecord } from './up-local.js';
import { stageAndReload, startWatch, type Run } from './up-reload.js';

export interface LocalUpDeps {
  build: (dir: string) => Promise<PackageBuild>;
  daemon: () => Promise<{ port: number; host: HostClient }>;
  npm: Npm;
  // Resolves with why up stops: a signal, `down`, or `watch died` once `ended` resolves.
  stopped: (dir: string, nonce: string, ended: Promise<string>) => Promise<string>;
}

export const localUpDeps: LocalUpDeps = {
  build: (dir) => buildPackage(dir),
  daemon: async () => {
    const port = await ensureDaemon();
    return { port, host: hostClient(port) };
  },
  npm: npmIn,
  stopped: (dir, nonce, ended) => untilStopped(dir, nonce, ended),
};

export interface LocalUp {
  id: string;
  version: string;
  url: string;
  port: number;
  added: boolean;
  stoppedBy: string;
}

// Checked before the daemon starts: a folder that is no extension package starts nothing.
const idOf = (dir: string): string => {
  const agentage = packageOf(dir)['agentage'];
  const id = isRecord(agentage) ? agentage['id'] : undefined;
  if (typeof id !== 'string') throw new CliError('invalid_argument', `${dir}: no agentage.id`);
  return id;
};

// Problems do not stop a local run; they are printed, as `extension build` would refuse them.
const warnProblems = async ({ report }: PackageBuild): Promise<void> => {
  if (report.conforms) return;
  for (const text of (await loadKitTool()).checkLines(report)) console.error(`check     ${text}`);
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

// The first build: in the folder while no child runs it (a create or an earlier up), else staged.
const firstBuild = async (run: Run, mode: UpMode, build: LocalUpDeps['build']): Promise<void> => {
  if (!(await folderRow(run.host, run.id, run.dir))) {
    await warnProblems(await build(run.dir));
    return seedNext(run.dir);
  }
  seedNext(run.dir);
  if (mode.kind === 'tsc' || mode.script) await stageAndReload(run);
};

// A watch that ends by itself stops up: one line, and a non-zero exit.
const deathOf = () => {
  let died: (why: string) => void = () => undefined;
  const ended = new Promise<string>((done) => (died = done));
  const onDied = (why: string): void => {
    console.error(`watch     tsc ${why}; extension up stops (run it again)`);
    died('watch died');
  };
  return { ended, onDied };
};

const exitFor = (stoppedBy: string): void => {
  if (stoppedBy === 'SIGINT') setExit(130);
  if (stoppedBy === 'watch died') setExit(1);
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
  const run: Run = { dir, id, host, npm: deps.npm };
  const mode = upModeOf(dir);
  // A stage of an earlier up may hold an old package.json: the first staged build copies it again.
  removeStage(dir);
  try {
    return await upAndWatch(run, mode, deps, { port, json, before });
  } finally {
    removeStage(dir);
  }
};

interface UpContext {
  port: number;
  json: boolean;
  before: UpRecord | null;
}

const upAndWatch = async (run: Run, mode: UpMode, deps: LocalUpDeps, ctx: UpContext) => {
  await firstBuild(run, mode, deps.build);
  const { row, already } = await installFolder(run.host, run.dir);
  const added = !already || ctx.before?.added === true;
  const nonce = randomUUID();
  const death = deathOf();
  const { watchers, tscPid } = startWatch(run, mode, death.onDied);
  const tsc = markOf(tscPid) ?? undefined;
  writeRecord(run.dir, { up: selfMark(), nonce, id: row.id, added, ...(tsc && { tsc }) });
  const url = `http://127.0.0.1:${ctx.port}/api/${row.id}/`;
  ready({ id: row.id, version: row.version, url, port: ctx.port, added }, ctx.json);
  const stoppedBy = await deps.stopped(run.dir, nonce, death.ended);
  for (const watcher of watchers) watcher.stop();
  stopLine(row.id, stoppedBy, added);
  exitFor(stoppedBy);
  return { id: row.id, version: row.version, url, port: ctx.port, added, stoppedBy };
};

// This up: pid and start time; where the start time cannot be read (Windows) it is never proven.
const selfMark = (): ProcessMark => markOf(process.pid) ?? { pid: process.pid, started: 'unknown' };
