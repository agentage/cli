import { isAlive, readDaemonFile, removeDaemonFile } from './daemon-file.js';
import {
  PROGRESS_MS,
  probeRetry,
  proven,
  sleep,
  unresponsive,
  type Probe,
} from './daemon-probe.js';

// The daemon drains each child for up to 10 s; past this it is killed.
const STOP_MS = 30_000;
const POLL_MS = 100;

// One stderr line once the wait passes PROGRESS_MS; never on stdout, so --json stays one object.
const gone = async (pid: number, timeoutMs: number, progressMs = PROGRESS_MS): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  const note = Date.now() + progressMs;
  let noted = false;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return false;
    if (!noted && Date.now() >= note)
      noted = (console.error(`waiting for the daemon (pid ${pid}) to stop...`), true);
    await sleep(POLL_MS);
  }
  return true;
};

const signal = (pid: number, name: NodeJS.Signals): void => {
  try {
    process.kill(pid, name);
  } catch {
    // exited in between
  }
};

// stopped: the pid, now gone; stale: daemon.json named no daemon of ours, so nothing was signalled.
export type StopResult = { stopped: number } | { stale: number } | null;

export interface StopDeps {
  probe: (port: number) => Promise<Probe>;
  timeoutMs: number;
  progressMs?: number;
}

const DEPS: StopDeps = { probe: (port) => probeRetry(port), timeoutMs: STOP_MS };

// A pid is signalled only when its own port answers as our daemon with that pid.
export const stopDaemon = async (deps: StopDeps = DEPS): Promise<StopResult> => {
  const file = readDaemonFile();
  if (!file) return null;
  if (!isAlive(file.pid)) return (removeDaemonFile(), { stale: file.pid });
  const found = await deps.probe(file.port);
  if (found.kind === 'silent') throw unresponsive(file);
  if (!proven(file, found)) return (removeDaemonFile(), { stale: file.pid });
  signal(file.pid, 'SIGTERM');
  if (!(await gone(file.pid, deps.timeoutMs, deps.progressMs))) signal(file.pid, 'SIGKILL');
  await gone(file.pid, 5_000);
  removeDaemonFile();
  return { stopped: file.pid };
};
