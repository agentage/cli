import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { childEnv } from '../../lib/child-env.js';
import { NEXT, type UpMode } from './up-build.js';

export interface Stoppable {
  stop: () => void;
}

// A recursive watch of one folder of the working copy; saves inside the debounce are one change.
export const watchFolder = (dir: string, onChange: () => void, debounceMs = 200): Stoppable => {
  if (!existsSync(dir)) return { stop: () => undefined };
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  return { stop: () => (clearTimeout(timer), watcher.close()) };
};

// One run at a time; a change during a run gives one more run after it, not one per save.
export const coalesced = (run: () => Promise<void>): (() => Promise<void>) => {
  let busy = false;
  let again = false;
  const go = async (): Promise<void> => {
    if (busy) return void (again = true);
    busy = true;
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      busy = false;
    }
  };
  return go;
};

export interface TscBuilt {
  errors: number;
  // From the change tsc saw to the end of its build.
  ms: number;
  first: boolean;
}

const FOUND = /Found (\d+) errors?\./;
const CHANGE = /File change detected/;

// The warm watch of D13: noEmitOnError, out to dist.next; each compiler error line goes to stderr.
export const watchTsc = (
  dir: string,
  mode: Extract<UpMode, { kind: 'tsc' }>,
  onBuilt: (built: TscBuilt) => void
): Stoppable => {
  const args = ['-p', mode.config, '--watch', '--preserveWatchOutput', '--noEmitOnError'];
  const child = spawn(mode.tsc, [...args, '--outDir', NEXT, '--pretty', 'false'], {
    cwd: dir,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let since = Date.now();
  let first = true;
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (CHANGE.test(line)) since = Date.now();
    const found = FOUND.exec(line);
    if (!found) return void (/error TS\d+/.test(line) && console.error(line));
    onBuilt({ errors: Number(found[1]), ms: Date.now() - since, first });
    first = false;
  });
  return { stop: () => void child.kill() };
};

// The rest of the build script (the widget bundle) runs in the folder; it writes dist/ui itself.
export const runRest = (dir: string, rest: string): Promise<boolean> =>
  new Promise((done) => {
    const bin = join(dir, 'node_modules', '.bin');
    const env = { ...childEnv(), PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}` };
    const child = spawn(rest, { cwd: dir, env, shell: true, stdio: ['ignore', 2, 2] });
    child.once('error', () => done(false));
    child.once('exit', (code) => done(code === 0));
  });
