import { join } from 'node:path';
import { getConfigDir } from '../lib/fs/config.js';

export const profilePath = (): string => join(getConfigDir(), 'profile.json');

export const machinePath = (): string => join(getConfigDir(), 'machine.json');

export const stateDir = (): string => join(getConfigDir(), 'state');

export const commandsPath = (): string => join(getConfigDir(), 'commands.json');

export const extensionsDir = (): string =>
  process.env['AGENTAGE_EXTENSIONS_DIR'] || join(getConfigDir(), 'extensions');

export const secretsPath = (): string => join(getConfigDir(), 'secrets.json');

export const dataDir = (id: string): string => join(getConfigDir(), 'data', id);

export const cacheDir = (id: string): string => join(getConfigDir(), 'cache', id);

export const logsDir = (): string => join(getConfigDir(), 'logs');
