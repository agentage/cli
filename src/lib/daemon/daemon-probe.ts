import { isRecord } from '../fs/json-file.js';
import { CliError } from '../json-output.js';
import { readDaemonFile, type DaemonFile } from './daemon-file.js';

// C4/C5: the protocol this cli speaks; a daemon with another one is restarted.
// A wait longer than this prints one line on stderr, so a slow start or stop does not look hung.
export const PROGRESS_MS = 3_000;

export const PROTOCOL = 1;
export const DAEMON_SERVICE = 'agentage-daemon';

export interface Health {
  status: string;
  service: string;
  pid: number;
  version: string;
  protocol: number;
  extensions: HealthEntry[];
}

// One entry of /health; kit 0.15 adds parts, seal and restarts (C1).
export interface HealthEntry {
  id: string;
  version: string;
  state: string;
  parts?: string[];
  seal?: 'on' | 'off';
  restarts?: number;
}

// What answers on a port: our daemon, another program, nothing (refused), or nothing in time.
export type Probe =
  { kind: 'ours'; health: Health } | { kind: 'foreign' } | { kind: 'none' } | { kind: 'silent' };

const isHealth = (body: unknown): body is Health =>
  isRecord(body) &&
  body['service'] === DAEMON_SERVICE &&
  Number.isInteger(body['pid']) &&
  typeof body['version'] === 'string' &&
  Array.isArray(body['extensions']);

export const probe = async (port: number, timeoutMs = 2000): Promise<Probe> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const body: unknown = await res.json().catch(() => null);
    return isHealth(body) ? { kind: 'ours', health: body } : { kind: 'foreign' };
  } catch (err) {
    const refused = (err as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED';
    return refused ? { kind: 'none' } : { kind: 'silent' };
  }
};

// A slow daemon is asked again before it counts as silent.
export const probeRetry = async (port: number, tries = 3, timeoutMs = 2000): Promise<Probe> => {
  let last: Probe = { kind: 'silent' };
  for (let i = 0; i < tries; i += 1) {
    last = await probe(port, timeoutMs);
    if (last.kind !== 'silent') return last;
  }
  return last;
};

// The proof that daemon.json names a daemon of ours: its port answers with the same pid.
export const proven = (file: DaemonFile, found: Probe): Health | null =>
  found.kind === 'ours' && found.health.pid === file.pid ? found.health : null;

// The port of daemon.json when its daemon is proven there, else null.
export const provenPort = async (look: (port: number) => Promise<Probe> = probe) => {
  const file = readDaemonFile();
  return file && proven(file, await look(file.port)) ? file.port : null;
};

export const unresponsive = (file: DaemonFile): CliError =>
  new CliError(
    'daemon_unresponsive',
    `the daemon (pid ${file.pid}) does not answer on 127.0.0.1:${file.port}; ` +
      'try again, or stop that process yourself'
  );

const killLine = (pid: number, platform = process.platform): string =>
  platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`;

const stopAdvice = (pid: number, platform?: NodeJS.Platform): string =>
  `stop it (agentage daemon stop with its AGENTAGE_CONFIG_DIR, or ${killLine(pid, platform)}), ` +
  'or set AGENTAGE_DAEMON_PORT to another port';

// The daemon of another config folder (AGENTAGE_CONFIG_DIR) holds the port: never used as ours.
export const otherFolder = (port: number, pid: number, platform?: NodeJS.Platform): CliError =>
  new CliError(
    'port_in_use',
    `port ${port} is in use by the agentage daemon (pid ${pid}) of another config folder; ` +
      stopAdvice(pid, platform)
  );

// This folder's daemon.json exists but cannot be read: the daemon on the port is not proven ours.
export const unreadableFile = (port: number, pid: number): CliError =>
  new CliError(
    'port_in_use',
    `port ${port} is in use by an agentage daemon (pid ${pid}), and daemon.json of this config ` +
      `folder cannot be read; ${stopAdvice(pid)}`
  );

export const portInUse = (port: number): CliError =>
  new CliError(
    'port_in_use',
    `port ${port} is in use by another program; free it, or set AGENTAGE_DAEMON_PORT to another port`
  );
