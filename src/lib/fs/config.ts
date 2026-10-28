import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from './file-lock.js';
import { isRecord, readJson, writeJsonAtomic } from './json-file.js';

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AuthState {
  siteFqdn: string;
  clientId: string;
  tokens: StoredTokens;
  user?: { id: string; email: string };
  // 'pat' marks a credential synthesized from a personal access token (AGENTAGE_TOKEN / --token):
  // it is never persisted, carries no refresh token, and must not attempt an OAuth refresh.
  kind?: 'pat';
}

export const getConfigDir = (): string =>
  process.env['AGENTAGE_CONFIG_DIR'] || join(process.env['HOME'] || homedir(), '.agentage');

export const ensureConfigDir = (): string => {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

const authPath = (): string => join(getConfigDir(), 'auth.json');

const isOptional = (value: unknown, type: 'string' | 'number'): boolean =>
  value === undefined || typeof value === type;

const isStoredTokens = (value: unknown): value is StoredTokens =>
  isRecord(value) &&
  typeof value['accessToken'] === 'string' &&
  isOptional(value['refreshToken'], 'string') &&
  isOptional(value['expiresAt'], 'number');

// A malformed auth.json (e.g. `{}`) reads as signed out rather than crashing every command.
export const isAuthState = (value: unknown): value is AuthState =>
  isRecord(value) &&
  typeof value['siteFqdn'] === 'string' &&
  typeof value['clientId'] === 'string' &&
  isStoredTokens(value['tokens']);

export const readAuth = (): AuthState | null => readJson(authPath(), isAuthState);

export const saveAuth = (state: AuthState): void => {
  ensureConfigDir();
  writeJsonAtomic(authPath(), state);
};

// Sign-out under the same lock mutateAuth takes (issue #236), so a concurrent token refresh can
// never slip its re-read+save between this existence check and the unlink.
export const deleteAuth = async (): Promise<void> => {
  ensureConfigDir();
  const path = authPath();
  await withFileLock(path, () => {
    if (existsSync(path)) unlinkSync(path);
  });
};

// Cross-process-safe read-modify-write on auth.json (issue #231). Under the advisory lock, re-read
// FRESH from disk, apply `fn`, then atomic-save - so a foreground sign-in and a background token
// refresh can never clobber each other. `fn` may return a new state, mutate the fresh one and return
// void, or leave a null re-read null (a concurrent sign-out is never resurrected). Any network
// refresh must run BEFORE this call, never under the lock. Returns the state on disk after the call.
export const mutateAuth = async (
  fn: (current: AuthState | null) => AuthState | null | void
): Promise<AuthState | null> => {
  ensureConfigDir();
  return withFileLock(authPath(), () => {
    const current = readAuth();
    const next = fn(current) ?? current;
    if (next) saveAuth(next);
    return next;
  });
};
