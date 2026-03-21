import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../daemon/config.js';

export interface AuthState {
  session: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  user: {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
  };
  hub: {
    url: string;
    machineId: string;
  };
}

const getAuthPath = (): string => join(getConfigDir(), 'auth.json');

export const readAuth = (): AuthState | null => {
  const path = getAuthPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
};

export const saveAuth = (state: AuthState): void => {
  writeFileSync(getAuthPath(), JSON.stringify(state, null, 2) + '\n', 'utf-8');
};

export const deleteAuth = (): void => {
  const path = getAuthPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
};
