import { join } from 'node:path';
import { getConfigDir } from '../lib/fs/config.js';

export const profilePath = (): string => join(getConfigDir(), 'profile.json');

export const machinePath = (): string => join(getConfigDir(), 'machine.json');

export const stateDir = (): string => join(getConfigDir(), 'state');

export const modulesDir = (): string =>
  process.env['AGENTAGE_MODULES_DIR'] || join(getConfigDir(), 'modules');
