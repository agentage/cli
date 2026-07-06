import { unwatchFile, watchFile } from 'node:fs';
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
import { vaultsJsonPath } from './lib/vaults.js';
import { createSyncManager } from './sync/manager.js';
import { VERSION } from './utils/version.js';

// The detached, long-lived engine host: one loopback HTTP server that owns a single in-process
// engine and serialises every vault mutation, avoiding concurrent git index.lock collisions. It
// also runs the git-sync loop (per-vault origin push/pull) and reschedules on config change.
const main = async (): Promise<void> => {
  const port = resolvePort();
  const manager = createSyncManager();
  const server = createDaemonServer({
    getClient: createClientProvider(),
    buildMcpServer: loadLocalMemoryServer,
    sync: { status: () => manager.status(), runNow: (vault) => manager.runNow(vault) },
    version: VERSION,
  });
  await server.start(port);
  writePidFile(process.pid);
  writePortFile(port);
  manager.reschedule();

  const configPath = vaultsJsonPath();
  watchFile(configPath, { interval: 2000 }, () => manager.reschedule());

  const shutdown = (): void => {
    unwatchFile(configPath);
    manager.stop();
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
