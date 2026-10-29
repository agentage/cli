import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { stateDir } from '../paths.js';
import { ID_PATTERN } from './manifest.js';

export const RUN_STATES = ['ok', 'failed', 'invalid', 'off', 'blocked', 'installed'] as const;

export type RunStateName = (typeof RUN_STATES)[number];

export interface RunState {
  at: string;
  pid: number;
  state: RunStateName;
  error: string | null;
}

export interface RunStateDeps {
  dir: () => string;
}

const defaultDeps: RunStateDeps = { dir: stateDir };

const isRunStateName = (value: unknown): value is RunStateName =>
  RUN_STATES.some((name) => name === value);

const isRunState = (value: unknown): value is RunState =>
  isRecord(value) &&
  typeof value['at'] === 'string' &&
  typeof value['pid'] === 'number' &&
  isRunStateName(value['state']) &&
  (value['error'] === undefined || value['error'] === null || typeof value['error'] === 'string');

// Reads the core's own record of the last run; plugin logs are never consulted.
export const readRunState = (id: string, deps: RunStateDeps = defaultDeps): RunState | null => {
  if (!ID_PATTERN.test(id)) return null;
  const found = readJson(join(deps.dir(), `${id}.json`), isRunState);
  if (!found) return null;
  return { at: found.at, pid: found.pid, state: found.state, error: found.error ?? null };
};
