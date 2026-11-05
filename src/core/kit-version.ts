import { createRequire } from 'node:module';
import { isRecord, readJson } from '../lib/fs/json-file.js';

let cached: string | undefined;

const read = (): string => {
  try {
    const path = createRequire(import.meta.url).resolve('@agentage/extension/package.json');
    const version = readJson(path, isRecord)?.['version'];
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

// The kit's own version (KIT_VERSION), read as data so startup never loads the kit's code.
export const kitVersion = (): string => (cached ??= read());
