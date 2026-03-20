import { fork } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigDir, loadConfig } from './config.js';
import { logInfo } from './logger.js';

const getPidPath = (): string => join(getConfigDir(), 'daemon.pid');

export const writePidFile = (pid: number): void => {
  writeFileSync(getPidPath(), String(pid), 'utf-8');
};

export const removePidFile = (): void => {
  const pidPath = getPidPath();
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
};

const readPid = (): number | null => {
  const pidPath = getPidPath();
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, 'utf-8').trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
};

const isProcessAlive = (pid: number): boolean => {
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
    return false;
  }
  return true;
};

export const getDaemonPid = (): number | null => {
  const pid = readPid();
  if (pid === null) return null;
  if (!isProcessAlive(pid)) {
    removePidFile();
    return null;
  }
  return pid;
};

export const startDaemon = (): Promise<void> => {
  if (isDaemonRunning()) return Promise.resolve();

  const daemonScript = join(fileURLToPath(import.meta.url), '..', '..', 'daemon-entry.js');

  const child = fork(daemonScript, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  if (child.pid) {
    writePidFile(child.pid);
    child.unref();
    logInfo(`Daemon started (PID ${child.pid})`);
  }

  // Wait for daemon to be ready
  return waitForDaemon();
};

const waitForDaemon = async (): Promise<void> => {
  const config = loadConfig();
  const port = config.daemon.port;
  const maxWait = 5000;
  const interval = 200;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Daemon failed to start within 5 seconds');
};

export const stopDaemon = (): void => {
  const pid = readPid();
  if (pid === null) return;

  if (isProcessAlive(pid)) {
    process.kill(pid, 'SIGTERM');
  }
  removePidFile();
  logInfo('Daemon stopped');
};

export const restartDaemon = async (): Promise<void> => {
  stopDaemon();
  // Brief pause for port release
  await new Promise((resolve) => setTimeout(resolve, 500));
  await startDaemon();
};
