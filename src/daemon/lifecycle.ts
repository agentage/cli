import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../lib/config.js';

// The daemon's on-disk state lives beside the config so an isolated AGENTAGE_CONFIG_DIR fully
// isolates a daemon (pid, port) from any other - tests never collide with a real one.
export const DEFAULT_DAEMON_PORT = 4243;

const pidPath = (): string => join(getConfigDir(), 'daemon.pid');
const portPath = (): string => join(getConfigDir(), 'daemon.port');

export const writePidFile = (pid: number): void => writeFileSync(pidPath(), String(pid), 'utf-8');
export const writePortFile = (port: number): void =>
  writeFileSync(portPath(), String(port), 'utf-8');

export const removePidFile = (): void => {
  if (existsSync(pidPath())) unlinkSync(pidPath());
};
export const removePortFile = (): void => {
  if (existsSync(portPath())) unlinkSync(portPath());
};

const readNumberFile = (path: string): number | null => {
  if (!existsSync(path)) return null;
  const n = Number.parseInt(readFileSync(path, 'utf-8').trim(), 10);
  return Number.isNaN(n) ? null : n;
};

// Env override wins (test isolation); else the running daemon's recorded port; else the default.
export const resolvePort = (): number => {
  const env = process.env['AGENTAGE_DAEMON_PORT'];
  if (env) {
    const n = Number.parseInt(env, 10);
    if (!Number.isNaN(n)) return n;
  }
  return readNumberFile(portPath()) ?? DEFAULT_DAEMON_PORT;
};

const readPid = (): number | null => readNumberFile(pidPath());

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const isDaemonRunning = (): boolean => {
  const pid = readPid();
  if (pid === null) return false;
  if (!isProcessAlive(pid)) {
    removePidFile();
    removePortFile();
    return false;
  }
  return true;
};

// SIGTERM the running daemon and clear its on-disk state; the daemon also self-cleans on exit.
// Returns whether a live process was actually signalled.
export const stopDaemon = (): boolean => {
  const pid = readPid();
  if (pid === null) return false;
  const alive = isProcessAlive(pid);
  if (alive) process.kill(pid, 'SIGTERM');
  removePidFile();
  removePortFile();
  return alive;
};

// Stop, then wait (bounded) for the old process to actually exit so a restart can rebind the
// port without an EADDRINUSE window. Returns whether the process is confirmed gone.
export const stopDaemonAndWait = async (timeoutMs = 2000): Promise<boolean> => {
  const pid = readPid();
  const signalled = stopDaemon();
  if (!signalled || pid === null) return true;
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
};
