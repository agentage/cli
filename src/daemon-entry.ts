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
import { VERSION } from './utils/version.js';

// The detached, long-lived engine host: one loopback HTTP server that owns a single in-process
// engine and serialises every vault mutation, avoiding concurrent git index.lock collisions.
const main = async (): Promise<void> => {
  const port = resolvePort();
  const server = createDaemonServer({
    getClient: createClientProvider(),
    buildMcpServer: loadLocalMemoryServer,
    version: VERSION,
  });
  await server.start(port);
  writePidFile(process.pid);
  writePortFile(port);

  const shutdown = (): void => {
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
