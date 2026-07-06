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
