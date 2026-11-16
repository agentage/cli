import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { messageOf, type Code } from '../../lib/json-output.js';
import { type Npm } from './package-build.js';
import { NEXT, stagedBuild, type UpMode } from './up-build.js';
import {
  coalesced,
  runRest,
  watchFolder,
  watchTsc,
  type Stoppable,
  type TscBuilt,
} from './up-watch.js';

export interface Run {
  dir: string;
  id: string;
  host: HostClient;
  npm: Npm;
  // Stops up with a reason: the build tool is missing, or the reload keeps failing.
  fatal?: (why: string, code?: Code) => void;
  // Reload calls that failed in a row.
  failed?: number;
  // When the build the daemon runs began: a save after it is not in that build.
  builtAt?: number;
}

// A save between the start of the running build and the end of the first watch build.
export const editedSince = (dir: string, since?: number): boolean => {
  const src = join(dir, 'src');
  if (since === undefined || !existsSync(src)) return false;
  return readdirSync(src, { recursive: true, withFileTypes: true }).some(
    (f) => f.isFile() && statSync(join(f.parentPath, f.name)).mtimeMs >= since
  );
};

// A daemon that refuses the call three times in a row will not take the next save either.
export const RELOAD_STRIKES = 3;

const failedReload = (run: Run, why: string): void => {
  console.error(`reload    ${run.id} failed: ${why}`);
  run.failed = (run.failed ?? 0) + 1;
  if (run.failed >= RELOAD_STRIKES)
    run.fatal?.(`the reload failed ${run.failed} times in a row`, 'daemon_unavailable');
};

type Task = () => Promise<void>;

// One lane for every write into dist.next and every reload: two of them never overlap.
export const lane = (): ((task: Task) => Promise<void>) => {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const next = tail.then(task);
    tail = next.catch(() => undefined);
    return next;
  };
};

// One line per reload: reloaded and the time, or the daemon's refusal (the last good build runs).
export const reload = async (run: Run, since: number): Promise<void> => {
  const { host, id } = run;
  const answer = await host.reload(id).catch((err: unknown) => ({ error: messageOf(err) }));
  const ms = Date.now() - since;
  if ('error' in answer) return failedReload(run, answer.error);
  run.failed = 0;
  if (answer.reloaded) return console.log(`reload    ${id} reloaded: true in ${ms} ms`);
  console.log(
    `reload    ${id} reloaded: false, refused: ${answer.refused ?? 'no reason'} (${ms} ms)`
  );
  console.log(`          ${id} the last good build runs`);
};

// npm or the script's own tool cannot run (127: command not found): no later save builds either.
const MISSING = /did not start|exited 127$/;

// A build that fails prints the compiler's words (its own stderr) and sends no reload.
export const stageAndReload = async (run: Run): Promise<void> => {
  const since = Date.now();
  try {
    await stagedBuild(run.dir, run.npm);
  } catch (err) {
    console.error(`build     failed, no reload: ${messageOf(err)}`);
    if (MISSING.test(messageOf(err))) run.fatal?.('the build tool is missing (npm ci installs it)');
    return;
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

// A reload only after a clean tsc build, never during one; a build during a reload gives one more.
export const tscReloads = (run: Run, inLane: (task: Task) => Promise<void>) => {
  const state = { building: false, pending: false, since: 0 };
  const go = coalesced(() =>
    inLane(async () => {
      if (state.building || !state.pending) return;
      state.pending = false;
      await reload(run, state.since);
    })
  );
  const onBuilt = ({ errors, ms, first }: TscBuilt): void => {
    state.building = false;
    if (errors > 0) console.error(`build     ${errors} error(s), no reload`);
    // The first watch build is the running one, unless a save came in while it built.
    const changed = !first || editedSince(run.dir, run.builtAt);
    if (errors === 0 && changed) Object.assign(state, { pending: true, since: Date.now() - ms });
    if (state.pending) void go();
  };
  return { onChange: () => void (state.building = true), onBuilt };
};

export interface Watch {
  watchers: Stoppable[];
  tscPid?: number;
}

const watchWithTsc = (
  run: Run,
  mode: Extract<UpMode, { kind: 'tsc' }>,
  onDied: (why: string) => void
): Watch => {
  const inLane = lane();
  const tsc = watchTsc(run.dir, mode, { ...tscReloads(run, inLane), onDied });
  if (!mode.rest) return { watchers: [tsc], tscPid: tsc.pid };
  const rest = mode.rest;
  const bundle = coalesced(() => inLane(() => bundleUi(run, rest)));
  const ui = watchFolder(join(run.dir, 'src', 'ui'), bundle);
  return { watchers: [tsc, ui], tscPid: tsc.pid };
};

export const startWatch = (run: Run, mode: UpMode, onDied: (why: string) => void): Watch => {
  if (mode.kind === 'tsc') return watchWithTsc(run, mode, onDied);
  if (!mode.script) console.error('watch     no build script: a change in src/ is not built');
  if (!existsSync(join(run.dir, 'src')))
    console.error('watch     no src/ folder: nothing to watch');
  if (!mode.script) return { watchers: [] };
  return {
    watchers: [
      watchFolder(
        join(run.dir, 'src'),
        coalesced(() => stageAndReload(run))
      ),
    ],
  };
};
