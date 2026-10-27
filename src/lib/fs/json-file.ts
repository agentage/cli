import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// null on a missing, unparsable or wrong-shaped file: callers treat all three as "absent".
export const readJson = <T>(path: string, guard: (value: unknown) => value is T): T | null => {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
};

const unlinkQuiet = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
};

// Unique temp sibling + chmod before rename: never half-written, never briefly world-readable.
export const writeJsonAtomic = (path: string, value: unknown, mode = 0o600): void => {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  let renamed = false;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf-8', mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
    renamed = true;
  } finally {
    if (!renamed) unlinkQuiet(tmp);
  }
};
