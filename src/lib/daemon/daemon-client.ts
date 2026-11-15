import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from '../fs/config.js';
import { CliError } from '../json-output.js';
import { VERSION } from '../../utils/version.js';
import {
  daemonPort,
  EADDRINUSE_EXIT,
  isAlive,
  readDaemonFile,
  removeDaemonFile,
  type DaemonFile,
} from './daemon-file.js';
import {
  portInUse,
  probe,
  probeRetry,
  PROTOCOL,
  proven,
  sleep,
  unresponsive,
  type Probe,
} from './daemon-probe.js';
import { stopDaemon, type StopResult } from './daemon-stop.js';

export type SpawnOutcome = 'ok' | 'port-in-use' | 'unreachable';

export interface EnsureDeps {
  probe: (port: number) => Promise<Probe>;
  spawn: (port: number) => Promise<SpawnOutcome>;
  stop: () => Promise<StopResult>;
  log: (line: string) => void;
}

const START_MS = 30_000;
const POLL_MS = 100;
// Over this the log moves to daemon.log.1 at the next start; one old file is kept.
export const LOG_CAP = 5 * 1024 * 1024;

export const waitForHealth = async (port: number, timeoutMs = START_MS): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe(port, 500)).kind === 'ours') return true;
    await sleep(POLL_MS);
  }
  return false;
};

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

// The token never reaches the daemon: it needs no account.
const daemonEnv = (port: number): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENTAGE_DAEMON_PORT: String(port) };
  delete env['AGENTAGE_TOKEN'];
  return env;
};

// Detached in its own process group, so it outlives this cli; the first to exit or answer wins.
export const spawnDaemon = async (port: number, entry = CLI_ENTRY): Promise<SpawnOutcome> => {
  const out = openDaemonLog();
  const child = spawn(process.execPath, [entry, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: daemonEnv(port),
  });
  closeSync(out);
  const exited = new Promise<SpawnOutcome>((resolve) =>
    child.once('exit', (code) => resolve(code === EADDRINUSE_EXIT ? 'port-in-use' : 'unreachable'))
  );
  child.unref();
  const healthy = waitForHealth(port).then((ok): SpawnOutcome => (ok ? 'ok' : 'unreachable'));
  return Promise.race([healthy, exited]);
};

export const defaultEnsureDeps: EnsureDeps = {
  probe: (port) => probeRetry(port),
  spawn: (port) => spawnDaemon(port),
  stop: () => stopDaemon(),
  log: (line) => console.error(line),
};

// Another cli may have started one on the same port at the same time: that one serves.
const start = async (deps: EnsureDeps, port: number): Promise<number> => {
  const outcome = await deps.spawn(port);
  if (outcome === 'port-in-use') {
    if ((await deps.probe(port)).kind === 'ours') return port;
    throw portInUse(port);
  }
  if (outcome !== 'ok') {
    const why = 'it did not answer (see logs/daemon.log in the config folder)';
    throw new CliError('daemon_unavailable', `the daemon did not start: ${why}`);
  }
  deps.log(`daemon started on 127.0.0.1:${port}`);
  return port;
};

// daemon.json's daemon when proven; a dead pid or another program there means the file is stale.
const fromFile = async (file: DaemonFile, deps: EnsureDeps): Promise<number | null> => {
  if (!isAlive(file.pid)) return (removeDaemonFile(), null);
  const found = await deps.probe(file.port);
  if (found.kind === 'silent') throw unresponsive(file);
  const health = proven(file, found);
  if (!health) return (removeDaemonFile(), null);
  if (health.version === VERSION && health.protocol === PROTOCOL) return file.port;
  await deps.stop();
  const port = await start({ ...deps, log: () => undefined }, daemonPort());
  deps.log(`daemon restarted: it ran ${health.version}, this cli is ${VERSION}`);
  return port;
};

export const ensureDaemon = async (deps: EnsureDeps = defaultEnsureDeps): Promise<number> => {
  if (process.env['AGENTAGE_NO_DAEMON'] === '1')
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
