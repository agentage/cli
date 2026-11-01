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
}

const isRunStateName = (value: unknown): value is RunStateName =>
  RUN_STATES.some((name) => name === value);

const isRunState = (value: unknown): value is RunState =>
  isRecord(value) &&
  typeof value['at'] === 'string' &&
  typeof value['pid'] === 'number' &&
  isRunStateName(value['state']) &&
  (value['error'] === undefined || value['error'] === null || typeof value['error'] === 'string');

// Reads the core's own record of the last run; extension logs are never consulted.
export const readRunState = (id: string): RunState | null => {
  if (!ID_PATTERN.test(id)) return null;
  const found = readJson(join(stateDir(), `${id}.json`), isRunState);
  if (!found) return null;
  return { at: found.at, pid: found.pid, state: found.state, error: found.error ?? null };
};

// Written by the core after each load attempt, never by the extension itself.
export const writeRunState = (id: string, run: Pick<RunState, 'state' | 'error'>): void => {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const state: RunState = { at: new Date().toISOString(), pid: process.pid, ...run };
  writeJsonAtomic(join(stateDir(), `${id}.json`), state);
};
