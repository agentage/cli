import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../child-env.js';
import { getConfigDir } from '../fs/config.js';
import { CliError } from '../json-output.js';
import { compareVersions } from '../update/update-check.js';
import { VERSION } from '../../utils/version.js';
import { waitFor } from '../wait.js';
import {
  daemonFilePath,
  daemonOff,
  daemonPort,
  EADDRINUSE_EXIT,
  isAlive,
  readDaemonFile,
  removeDaemonFile,
  type DaemonFile,
} from './daemon-file.js';
import {
  otherFolder,
  unreadableFile,
  portInUse,
  probe,
  probeRetry,
  PROGRESS_MS,
  PROTOCOL,
  proven,
  unresponsive,
  type Health,
  type Probe,
} from './daemon-probe.js';
import { stopDaemon, type StopResult } from './daemon-stop.js';

export type SpawnOutcome = 'ok' | 'port-in-use' | 'unreachable';

export interface EnsureDeps {
  probe: (port: number) => Promise<Probe>;
  spawn: (port: number) => Promise<SpawnOutcome>;
  stop: () => Promise<StopResult>;
  log: (line: string) => void;
  // How long a busy port waits for this folder's daemon.json (default LATE_FILE_MS).
  lateMs?: number;
}

const START_MS = 30_000;
// Over this the log moves to daemon.log.1 at the next start; one old file is kept.
export const LOG_CAP = 5 * 1024 * 1024;
// A busy port: how long daemon.json of this folder may take to appear (written after listen).
export const LATE_FILE_MS = 2_000;

const answersAs = (pid: number, found: Probe): boolean =>
  found.kind === 'ours' && found.health.pid === pid;

const announced = (pid: number): boolean => readDaemonFile()?.pid === pid;

// Healthy only as the spawned pid, and once its daemon.json (the host token) is written after listen.
export const waitForHealth = (port: number, pid: number, timeoutMs = START_MS): Promise<boolean> =>
  waitFor(async () => answersAs(pid, await probe(port, 500)) && announced(pid), timeoutMs, {
    afterMs: PROGRESS_MS,
    line: `waiting for the daemon to start on 127.0.0.1:${port}...`,
  });

const CLI_ENTRY = fileURLToPath(new URL('../../cli.js', import.meta.url));

export const daemonLogPath = (): string => join(getConfigDir(), 'logs', 'daemon.log');

// The daemon's own output (each child's too), so a start that fails can be read later.
export const openDaemonLog = (cap = LOG_CAP): number => {
  const path = daemonLogPath();
  mkdirSync(join(getConfigDir(), 'logs'), { recursive: true, mode: 0o700 });
  const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (size > cap) renameSync(path, `${path}.1`);
  return openSync(path, 'a', 0o600);
};

// Detached in its own process group, so it outlives this cli; the first to exit or answer wins.
export const spawnDaemon = async (port: number, entry = CLI_ENTRY): Promise<SpawnOutcome> => {
  const out = openDaemonLog();
  const child = spawn(process.execPath, [entry, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...childEnv(), AGENTAGE_DAEMON_PORT: String(port) },
  });
  closeSync(out);
  const exited = new Promise<SpawnOutcome>((resolve) =>
    child.once('exit', (code) => resolve(code === EADDRINUSE_EXIT ? 'port-in-use' : 'unreachable'))
  );
  child.unref();
  const healthy = waitForHealth(port, child.pid ?? 0).then((ok): SpawnOutcome =>
    ok ? 'ok' : 'unreachable'
  );
  return Promise.race([healthy, exited]);
};

export const defaultEnsureDeps: EnsureDeps = {
  probe: (port) => probeRetry(port),
  spawn: (port) => spawnDaemon(port),
  stop: () => stopDaemon(),
  log: (line) => console.error(line),
};

// A start that timed out may still have come up late: a proven daemon in daemon.json serves.
const lateDaemon = async (deps: EnsureDeps): Promise<number | null> => {
  const file = readDaemonFile();
  return file && proven(file, await deps.probe(file.port)) ? file.port : null;
};

const notStarted = (): CliError =>
  new CliError(
    'daemon_unavailable',
    `the daemon did not start: it did not answer; see agentage daemon status and ${daemonLogPath()}`
  );

// Another cli of this folder may have started one at the same time: its daemon.json can lag.
const ownLate = async (deps: EnsureDeps, port: number, ms: number): Promise<boolean> =>
  waitFor(async () => (await lateDaemon(deps)) === port, ms);

// A busy port is ours only through this folder's daemon.json; else it is refused, never used.
const busyPort = async (deps: EnsureDeps, port: number): Promise<number> => {
  if (await ownLate(deps, port, deps.lateMs ?? LATE_FILE_MS)) return port;
  const found = await deps.probe(port);
  if (found.kind !== 'ours') throw portInUse(port);
  if (existsSync(daemonFilePath())) throw unreadableFile(port, found.health.pid);
  throw otherFolder(port, found.health.pid);
};

const start = async (deps: EnsureDeps, port: number): Promise<number> => {
  const outcome = await deps.spawn(port);
  if (outcome === 'port-in-use') return busyPort(deps, port);
  if (outcome !== 'ok') {
    const late = await lateDaemon(deps);
    if (late === null) throw notStarted();
    return late;
  }
  deps.log(`daemon started on 127.0.0.1:${port}`);
  return port;
};

// Restart only for another protocol or an older daemon: a newer one serves as it is.
const outdated = (health: { version: string; protocol: number }): boolean =>
  health.protocol !== PROTOCOL || compareVersions(health.version, VERSION) < 0;

// D11: a daemon that wrote no hostToken (cli 0.52 or older) refuses every /host/* call of this cli.
const restartReason = (file: DaemonFile, health: Health): string | null => {
  if (outdated(health)) return `it ran ${health.version}, this cli is ${VERSION}`;
  return file.hostToken ? null : `it ran ${health.version} with no host token`;
};

// daemon.json's daemon when proven; a dead pid, or a live one whose port refuses, is a stale file.
const fromFile = async (file: DaemonFile, deps: EnsureDeps): Promise<number | null> => {
  if (!isAlive(file.pid)) return (removeDaemonFile(), null);
  const found = await deps.probe(file.port);
  if (found.kind === 'silent') throw unresponsive(file);
  // daemon.json is written after the daemon listens: a refused port means a reused pid.
  if (found.kind === 'none') return (removeDaemonFile(), null);
  const health = proven(file, found);
  if (!health)
    throw found.kind === 'ours' ? otherFolder(file.port, found.health.pid) : portInUse(file.port);
  const why = restartReason(file, health);
  if (!why) return file.port;
  await deps.stop();
  const port = await start({ ...deps, log: () => undefined }, daemonPort());
  deps.log(`daemon restarted: ${why}`);
  return port;
};

export const ensureDaemon = async (deps: EnsureDeps = defaultEnsureDeps): Promise<number> => {
  if (daemonOff())
    throw new CliError('daemon_disabled', 'AGENTAGE_NO_DAEMON=1 is set: no daemon is used');
  const file = readDaemonFile();
  const live = file ? await fromFile(file, deps) : null;
  return live ?? start(deps, daemonPort());
};

// After `agentage update`: a daemon that ran stops and starts again from the new files.
export const restartIfRunning = async (deps: EnsureDeps = defaultEnsureDeps): Promise<boolean> => {
  const result = await deps.stop();
  if (result === null || !('stopped' in result)) return false;
  await start({ ...deps, log: () => undefined }, daemonPort());
  deps.log(`daemon restarted on 127.0.0.1:${daemonPort()}`);
  return true;
};
