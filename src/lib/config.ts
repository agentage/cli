import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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

export const saveAuth = (state: AuthState): void => {
  ensureConfigDir();
  const path = authPath();
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  chmodSync(path, 0o600);
};

export const deleteAuth = (): void => {
  const path = authPath();
  if (existsSync(path)) unlinkSync(path);
};
