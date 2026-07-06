import { unwatchFile, watchFile } from 'node:fs';
import { isAccountVault } from '@agentage/memory-core';
import { createClientProvider } from './daemon/client-provider.js';
import {
  removePidFile,
  removePortFile,
  resolvePort,
  writePidFile,
  writePortFile,
} from './daemon/lifecycle.js';
import { createDaemonServer } from './daemon/server.js';
import { loadLocalMemoryServer } from './mcp/local-server.js';
import { loadVaultsConfig, vaultsJsonPath } from './lib/vaults.js';
import { createCouchSyncManager } from './sync/couch/manager.js';
import { createSyncManager } from './sync/manager.js';
import { VERSION } from './utils/version.js';

// The detached, long-lived engine host: one loopback HTTP server that owns a single in-process
// engine and serialises every vault mutation, avoiding concurrent git index.lock collisions. It
// runs both sync loops (git origins + the account/couch channel) and reschedules on config change.
const main = async (): Promise<void> => {
  const port = resolvePort();
  const git = createSyncManager();
  const couch = createCouchSyncManager();

  // A vault is on exactly one channel: an account (agentage) vault syncs over couch, else git.
  const runNow = (
    vault: string
  ): ReturnType<typeof couch.runNow> | ReturnType<typeof git.runNow> => {
    const entry = loadVaultsConfig().config.vaults?.[vault];
    return entry && isAccountVault(entry) ? couch.runNow(vault) : git.runNow(vault);
  };

  const server = createDaemonServer({
    getClient: createClientProvider(),
    buildMcpServer: loadLocalMemoryServer,
    sync: {
      status: () => ({ ...git.status(), couch: couch.status() }),
      runNow,
    },
    onMutation: (verb, body) => couch.onWrite(verb, body),
    version: VERSION,
  });
  await server.start(port);
  writePidFile(process.pid);
  writePortFile(port);
  git.reschedule();
  couch.reschedule();

  const configPath = vaultsJsonPath();
  watchFile(configPath, { interval: 2000 }, () => {
    git.reschedule();
    couch.reschedule();
  });

  const shutdown = (): void => {
    unwatchFile(configPath);
    git.stop();
    couch.stop();
    server.stop().finally(() => {
      removePidFile();
      removePortFile();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  removePidFile();
  removePortFile();
  process.exit(1);
});
