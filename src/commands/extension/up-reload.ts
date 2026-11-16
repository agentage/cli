import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { messageOf } from '../../lib/json-output.js';
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
}

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
export const stageAndReload = async (run: Run): Promise<void> => {
  const since = Date.now();
  try {
    await stagedBuild(run.dir, run.npm);
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
    if (errors === 0 && !first) Object.assign(state, { pending: true, since: Date.now() - ms });
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
