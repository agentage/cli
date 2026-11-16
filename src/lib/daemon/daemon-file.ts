import { join } from 'node:path';
import { getConfigDir } from '../fs/config.js';
import { isRecord, readJson, unlinkQuiet } from '../fs/json-file.js';

export const DEFAULT_DAEMON_PORT = 4243;

// `daemon run` exits with this on a busy port, so the cli that spawned it stops waiting at once.
export const EADDRINUSE_EXIT = 3;

// C4: what the daemon writes when it listens.
export interface DaemonFile {
  pid: number;
  port: number;
  version: string;
  protocol: number;
  startedBy: string;
  // D11 (kit 0.15): sent as a bearer on /host/*; a daemon of cli 0.52 or older writes none.
  hostToken?: string;
}

export const daemonPort = (env: NodeJS.ProcessEnv = process.env): number => {
  const port = Number(env['AGENTAGE_DAEMON_PORT']);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_DAEMON_PORT;
};

// AGENTAGE_NO_DAEMON=1: no command starts or uses the daemon.
export const daemonOff = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env['AGENTAGE_NO_DAEMON'] === '1';

export const daemonFilePath = (): string => join(getConfigDir(), 'daemon.json');

// A pid the cli may signal: 0 and -1 name process groups, 1 is init.
export const isPid = (pid: unknown): pid is number => Number.isInteger(pid) && (pid as number) > 1;

const isDaemonFile = (value: unknown): value is DaemonFile =>
  isRecord(value) && isPid(value['pid']) && Number.isInteger(value['port']);

export const readDaemonFile = (): DaemonFile | null => readJson(daemonFilePath(), isDaemonFile);

export const readHostToken = (): string | undefined => {
  const token = readDaemonFile()?.hostToken;
  return typeof token === 'string' && token !== '' ? token : undefined;
};

export const removeDaemonFile = (): void => unlinkQuiet(daemonFilePath());

// EPERM: the pid lives, under another user.
export const isAlive = (pid: number): boolean => {
  if (!isPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};
