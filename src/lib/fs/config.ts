import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from './file-lock.js';

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

export const readAuth = (): AuthState | null => {
  const path = authPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AuthState;
  } catch {
    return null;
  }
};

// Atomic 0600 write: a token file is never left half-written or briefly world-readable. Write a
// per-save sibling temp (unique name: concurrent savers can never clobber each other's tmp),
// chmod it 0600 BEFORE the rename, then rename over the target in one step.
export const saveAuth = (state: AuthState): void => {
  ensureConfigDir();
  const path = authPath();
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
};

export const deleteAuth = (): void => {
  const path = authPath();
  if (existsSync(path)) unlinkSync(path);
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
