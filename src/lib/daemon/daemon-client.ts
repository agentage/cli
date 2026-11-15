import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from '../fs/config.js';
import { isRecord } from '../fs/json-file.js';
import { CliError } from '../json-output.js';
import {
  daemonPort,
  EADDRINUSE_EXIT,
  isAlive,
  readDaemonFile,
  removeDaemonFile,
} from './daemon-file.js';

export interface Health {
  status: string;
  version: string;
  extensions: { id: string; version: string; state: string }[];
}

export type SpawnOutcome = 'ok' | 'port-in-use' | 'unreachable';

export interface EnsureDeps {
  health: (port: number) => Promise<Health | null>;
  spawn: (port: number) => Promise<SpawnOutcome>;
  log: (line: string) => void;
}

const START_MS = 30_000;
const POLL_MS = 100;

export const health = async (port: number, timeoutMs = 1000): Promise<Health | null> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = res.ok ? await res.json() : null;
    return isRecord(body) && typeof body['status'] === 'string'
      ? (body as unknown as Health)
      : null;
  } catch {
    return null;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForHealth = async (port: number, timeoutMs = START_MS): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await health(port, 500)) return true;
    await sleep(POLL_MS);
  }
  return false;
};

const CLI_ENTRY = fileURLToPath(new URL('../../cli.js', import.meta.url));

// The daemon's own output, so a start that fails can be read later.
const logFile = (): number => {
  const dir = join(getConfigDir(), 'logs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return openSync(join(dir, 'daemon.log'), 'a', 0o600);
};

// The token never reaches the daemon: it needs no account.
const daemonEnv = (port: number): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENTAGE_DAEMON_PORT: String(port) };
  delete env['AGENTAGE_TOKEN'];
  return env;
};

// Detached in its own process group, so it outlives this cli; the first to exit or answer wins.
export const spawnDaemon = async (port: number, entry = CLI_ENTRY): Promise<SpawnOutcome> => {
  const out = logFile();
  const child = spawn(process.execPath, [entry, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: daemonEnv(port),
  });
  const exited = new Promise<SpawnOutcome>((resolve) =>
    child.once('exit', (code) => resolve(code === EADDRINUSE_EXIT ? 'port-in-use' : 'unreachable'))
  );
  child.unref();
  const healthy = waitForHealth(port).then((ok): SpawnOutcome => (ok ? 'ok' : 'unreachable'));
  return Promise.race([healthy, exited]);
};

const defaultDeps: EnsureDeps = {
  health: (port) => health(port),
  spawn: (port) => spawnDaemon(port),
  log: (line) => console.error(line),
};

// The port of a live daemon: the one daemon.json names, else a new one; a stale file is removed.
const livePort = async (deps: EnsureDeps): Promise<number | null> => {
  const file = readDaemonFile();
  if (file && isAlive(file.pid) && (await deps.health(file.port))) return file.port;
  if (file) removeDaemonFile();
  return null;
};

// Another cli started one on the same port at the same time: that one serves.
const started = async (deps: EnsureDeps, port: number): Promise<boolean> => {
  const outcome = await deps.spawn(port);
  if (outcome === 'ok') return true;
  if (outcome === 'port-in-use' && (await deps.health(port))) return true;
  const why = outcome === 'port-in-use' ? `port ${port} is in use` : 'it did not answer';
  throw new CliError('daemon_unavailable', `the daemon did not start: ${why}`);
};

export const ensureDaemon = async (deps: EnsureDeps = defaultDeps): Promise<number> => {
  const live = await livePort(deps);
  if (live !== null) return live;
  const port = daemonPort();
  await started(deps, port);
  deps.log(`daemon started on 127.0.0.1:${port}`);
  return port;
};
