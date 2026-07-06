import { existsSync, statSync } from 'node:fs';
import { createDirectClient, type MemoryClient } from '../lib/memory-client.js';
import { loadVaultsConfig, vaultsJsonPath } from '../lib/vaults.js';

// One in-process engine per daemon, rebuilt only when vaults.json changes on disk, so a
// `vault add` between requests is picked up without a daemon restart.
export const createClientProvider = (): (() => MemoryClient) => {
  let cached: { client: MemoryClient; mtime: number } | undefined;
  return () => {
    const path = vaultsJsonPath();
    const mtime = existsSync(path) ? statSync(path).mtimeMs : 0;
    if (!cached || cached.mtime !== mtime) {
      cached = { client: createDirectClient(loadVaultsConfig().config), mtime };
    }
    return cached.client;
  };
};
