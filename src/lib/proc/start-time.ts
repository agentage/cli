import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isPid } from '../daemon/daemon-file.js';
import { isRecord } from '../fs/json-file.js';

// Field 22 of /proc/<pid>/stat, counted from the state field after the `(comm)` part.
const STARTTIME = 19;

const fromProc = (pid: number): string | null => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[STARTTIME] ?? null;
};

const fromPs = (pid: number): string | null =>
  execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null;

export type ReadStart = (pid: number) => string | null;

// When a pid started: a pid plus this proves one process, a reused pid has another.
// Windows has neither /proc nor ps: null there, so a process is never proven and never signalled.
export const startedAt: ReadStart = (pid) => {
  if (!isPid(pid) || process.platform === 'win32') return null;
  try {
    return process.platform === 'linux' ? fromProc(pid) : fromPs(pid);
  } catch {
    return null;
  }
};

export interface ProcessMark {
  pid: number;
  started: string;
}

export const markOf = (
  pid: number | undefined,
  read: ReadStart = startedAt
): ProcessMark | null => {
  const started = pid === undefined ? null : read(pid);
  return pid !== undefined && started !== null ? { pid, started } : null;
};

export const isMark = (value: unknown): value is ProcessMark =>
  isRecord(value) && isPid(value['pid']) && typeof value['started'] === 'string';

// The same process still runs: the pid lives and started at the recorded time.
export const proven = (mark: ProcessMark | undefined | null): boolean =>
  mark ? startedAt(mark.pid) === mark.started : false;

// SIGTERM only to a proven process; anything else is left alone and reported.
export const stopProven = (mark: ProcessMark): boolean => {
  if (!proven(mark)) return false;
  try {
    process.kill(mark.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
};
