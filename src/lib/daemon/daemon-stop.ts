import { isAlive, readDaemonFile, removeDaemonFile } from './daemon-file.js';

// The daemon drains each child for up to 10 s; past this it is killed.
const STOP_MS = 30_000;
const POLL_MS = 100;

const gone = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
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

// The pid it stopped, or null when none ran; returns only once that pid is gone.
export const stopDaemon = async (timeoutMs = STOP_MS): Promise<number | null> => {
  const file = readDaemonFile();
  if (!file || !isAlive(file.pid)) {
    removeDaemonFile();
    return null;
  }
  signal(file.pid, 'SIGTERM');
  if (!(await gone(file.pid, timeoutMs))) signal(file.pid, 'SIGKILL');
  await gone(file.pid, 5_000);
  removeDaemonFile();
  return file.pid;
};
