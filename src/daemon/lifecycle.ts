import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from '../lib/config.js';

// The daemon's on-disk state lives beside the config so an isolated AGENTAGE_CONFIG_DIR fully
// isolates a daemon (pid, port, token) from any other - tests never collide with a real one.
export const DEFAULT_DAEMON_PORT = 4243;

// The daemon entry exits with this code on EADDRINUSE so a spawning CLI can short-circuit fast.
export const EADDRINUSE_EXIT_CODE = 3;

const pidPath = (): string => join(getConfigDir(), 'daemon.pid');
const portPath = (): string => join(getConfigDir(), 'daemon.port');
const tokenPath = (): string => join(getConfigDir(), 'daemon.token');

export const writePidFile = (pid: number): void => writeFileSync(pidPath(), String(pid), 'utf-8');
export const writePortFile = (port: number): void =>
  writeFileSync(portPath(), String(port), 'utf-8');

// A 256-bit per-daemon secret gating /api/*; only a same-machine client that can read the 0600
// file (so, the same user) can call it, closing the loopback socket to any other local process.
export const generateDaemonToken = (): string => randomBytes(32).toString('hex');

export const writeTokenFile = (token: string): void =>
  writeFileSync(tokenPath(), token, { encoding: 'utf-8', mode: 0o600 });

export const readDaemonToken = (): string | null => {
  if (!existsSync(tokenPath())) return null;
  const token = readFileSync(tokenPath(), 'utf-8').trim();
  return token.length > 0 ? token : null;
};

export const removePidFile = (): void => {
  if (existsSync(pidPath())) unlinkSync(pidPath());
};
export const removePortFile = (): void => {
  if (existsSync(portPath())) unlinkSync(portPath());
};
export const removeTokenFile = (): void => {
  if (existsSync(tokenPath())) unlinkSync(tokenPath());
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
    removeTokenFile();
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
  removeTokenFile();
  return alive;
};

// Lightweight, cycle-free /health probe (daemon-client imports this module) returning the reported
// pid; null when the port holds no reachable agentage daemon.
const probeDaemonPid = async (port: number): Promise<number | null> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    const h = (await res.json()) as { pid?: unknown };
    return typeof h.pid === 'number' ? h.pid : null;
  } catch {
    return null;
  }
};

// stopDaemon signals a bare recorded pid, which the OS may have recycled onto an unrelated process.
// Guard it: signal only when /health confirms the pid is our daemon, or - if no port was recorded -
// fall back to the blind signal with a printed caveat. Refuse otherwise rather than kill a stranger.
export const stopDaemonSafely = async (
  probe: (port: number) => Promise<number | null> = probeDaemonPid
): Promise<boolean> => {
  const pid = readPid();
  if (pid === null || !isProcessAlive(pid)) return stopDaemon();
  const port = readNumberFile(portPath());
  const confirmed = port !== null && (await probe(port)) === pid;
  if (confirmed) return stopDaemon();
  if (port === null) {
    console.error(chalk.yellow(`No recorded port; signalling pid ${pid} without confirmation.`));
    return stopDaemon();
  }
  console.error(
    chalk.yellow(
      `Daemon on port ${port} did not confirm pid ${pid}; not signalling. Delete the pid file to force.`
    )
  );
  return false;
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
