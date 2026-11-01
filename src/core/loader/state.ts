import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { stateDir } from '../paths.js';
import { ID_PATTERN } from './manifest.js';

export const RUN_STATES = ['ok', 'failed', 'invalid', 'off', 'blocked', 'installed'] as const;

export type RunStateName = (typeof RUN_STATES)[number];

export interface RunState {
  at: string;
  pid: number;
  state: RunStateName;
  error: string | null;
  // The version this load ran.
  version: string | null;
  // The version that last loaded ok on this machine: the next load's ctx.previousVersion.
  lastOk: string | null;
}

const isRunStateName = (value: unknown): value is RunStateName =>
  RUN_STATES.some((name) => name === value);

// Absent in files written before the field existed.
const optionalText = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string';

type StoredRun = Pick<RunState, 'at' | 'pid' | 'state'> & Partial<RunState>;

const isRunState = (value: unknown): value is StoredRun =>
  isRecord(value) &&
  typeof value['at'] === 'string' &&
  typeof value['pid'] === 'number' &&
  isRunStateName(value['state']) &&
  ['error', 'version', 'lastOk'].every((key) => optionalText(value[key]));

// Reads the core's own record of the last run; extension logs are never consulted.
export const readRunState = (id: string): RunState | null => {
  if (!ID_PATTERN.test(id)) return null;
  const found = readJson(join(stateDir(), `${id}.json`), isRunState);
  if (!found) return null;
  const { at, pid, state, error = null, version = null, lastOk = null } = found;
  return { at, pid, state, error, version, lastOk };
};

// Written by the core after each load attempt; a failed one keeps the last ok version.
export const writeRunState = (
  id: string,
  run: Pick<RunState, 'state' | 'error' | 'version'>
): void => {
  const lastOk = run.state === 'ok' ? run.version : (readRunState(id)?.lastOk ?? null);
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const state: RunState = { at: new Date().toISOString(), pid: process.pid, ...run, lastOk };
  writeJsonAtomic(join(stateDir(), `${id}.json`), state);
};
