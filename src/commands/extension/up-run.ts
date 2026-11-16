import { randomUUID } from 'node:crypto';
import { markOf } from '../../lib/proc/start-time.js';
import { resolve } from 'node:path';
import { isRecord } from '../../lib/fs/json-file.js';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { hostClient, type HostClient } from '../../lib/daemon/host-client.js';
import { setExit } from '../../lib/exit-code.js';
import { CliError, type Code } from '../../lib/json-output.js';
import { folderRow, installFolder } from './install-once.js';
import { loadKitTool } from './kit-tool.js';
import { buildPackage, npmIn, packageOf, type Npm, type PackageBuild } from './package-build.js';
import { removeStage, seedNext, upModeOf, type UpMode } from './up-build.js';
import { claimFolder, rewriteRecord, selfMark, untilStopped, type UpRecord } from './up-local.js';
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

// A watch that ends by itself, a missing build tool or a reload that keeps failing stops up.
const deathOf = () => {
  let died: (why: string) => void = () => undefined;
  let reason = '';
  let code: Code = 'build_failed';
  const ended = new Promise<string>((done) => (died = done));
  const onDied = (why: string, as: Code = 'build_failed'): void => {
    if (reason) return;
    [reason, code] = [why, as];
    console.error(`watch     ${why}; extension up stops (run it again)`);
    died('watch died');
  };
  const failure = () => new CliError(code, `extension up stopped: ${reason}`);
  return { ended, onDied, failure, died: () => reason !== '' };
};

// Ctrl-C is 130 and a closed terminal 129; a watch that died fails, so --json gives the error.
const exitFor = (stoppedBy: string, failure: () => CliError): void => {
  if (stoppedBy === 'SIGINT') setExit(130);
  if (stoppedBy === 'SIGHUP') setExit(129);
  if (stoppedBy === 'watch died') throw failure();
};

// D12: build, the folder as a daemon row, a watch that builds to dist.next and reloads that child.
export const runLocalUp = async (
  folder = '.',
  deps = localUpDeps,
  json = false
): Promise<LocalUp> => {
  const dir = resolve(folder);
  const id = idOf(dir);
  const nonce = randomUUID();
  const before = await claimFolder(dir, nonce, id);
  const { port, host } = await deps.daemon();
  const run: Run = { dir, id, host, npm: deps.npm };
  const mode = upModeOf(dir);
  // A stage of an earlier up may hold an old package.json: the first staged build copies it again.
  removeStage(dir);
  try {
    return await upAndWatch(run, mode, deps, { port, json, before, nonce });
  } finally {
    removeStage(dir);
  }
};

interface UpContext {
  port: number;
  json: boolean;
  before: UpRecord | null;
  nonce: string;
}

type Death = ReturnType<typeof deathOf>;
type Up = Omit<LocalUp, 'stoppedBy'>;

// The fatal channel is wired before the first build: a second up with no build tool stops too.
const upAndWatch = async (run: Run, mode: UpMode, deps: LocalUpDeps, ctx: UpContext) => {
  const death = deathOf();
  run.fatal = death.onDied;
  run.builtAt = Date.now();
  await firstBuild(run, mode, deps.build);
  if (death.died()) throw death.failure();
  const { row, already } = await installFolder(run.host, run.dir);
  const added = !already || ctx.before?.added === true;
  const up = {
    id: row.id,
    version: row.version,
    url: urlOf(ctx.port, row.id),
    port: ctx.port,
    added,
  };
  const stoppedBy = await watchUntilStopped(run, mode, { deps, ctx, death, up });
  stopLine(up.id, stoppedBy, added);
  exitFor(stoppedBy, death.failure);
  return { ...up, stoppedBy };
};

interface Watching {
  deps: LocalUpDeps;
  ctx: UpContext;
  death: Death;
  up: Up;
}

// No record is left for down to read, so a row this up added goes with the cancelled start.
const cancelled = async (run: Run, up: Up, err: unknown): Promise<never> => {
  if (up.added && err instanceof CliError && err.code === 'cancelled') {
    if (await folderRow(run.host, up.id, run.dir)) await run.host.remove(up.id, false);
  }
  throw err;
};

// A record down removed meanwhile, or one that cannot be written, still stops the tsc it started.
const watchUntilStopped = async (run: Run, mode: UpMode, w: Watching): Promise<string> => {
  const { watchers, tscPid } = startWatch(run, mode, w.death.onDied);
  try {
    const tsc = markOf(tscPid) ?? undefined;
    const { nonce } = w.ctx;
    await rewriteRecord(run.dir, {
      up: selfMark(),
      nonce,
      id: w.up.id,
      added: w.up.added,
      ...(tsc && { tsc }),
    }).catch((err: unknown) => cancelled(run, w.up, err));
    ready(w.up, w.ctx.json);
    return await w.deps.stopped(run.dir, nonce, w.death.ended);
  } finally {
    for (const watcher of watchers) watcher.stop();
  }
};

const urlOf = (port: number, id: string): string => `http://127.0.0.1:${port}/api/${id}/`;
