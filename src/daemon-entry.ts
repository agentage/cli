import { loadConfig } from './daemon/config.js';
import { logError, logInfo } from './daemon/logger.js';
import { writePidFile, removePidFile } from './daemon/daemon.js';
import { createDaemonServer } from './daemon/server.js';
import { scanAgents } from './discovery/scanner.js';
import { createMarkdownFactory } from './discovery/markdown-factory.js';
import { createCodeFactory } from './discovery/code-factory.js';
import { getHubSync } from './hub/hub-sync.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  logInfo(`Daemon starting (PID ${process.pid})`);
  writePidFile(process.pid);

  const server = createDaemonServer();
  const factories = [createMarkdownFactory(), createCodeFactory()];
  server.setFactories(factories);

  // Initial agent discovery
  const agents = await scanAgents(config.discovery.dirs, factories);
  server.updateAgents(agents);
  logInfo(`Discovered ${agents.length} agent(s)`);

  await server.start();
  logInfo(`Daemon ready on port ${config.daemon.port}`);

  // Initialize hub sync (registers + heartbeat if auth.json exists)
  const hubSync = getHubSync();
  await hubSync.start();

  const shutdown = async (): Promise<void> => {
    logInfo('Daemon shutting down...');
    await hubSync.stop();
    await server.stop();
    removePidFile();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    shutdown().catch((err: unknown) => {
      logError(`Shutdown error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  });

  process.on('SIGINT', () => {
    shutdown().catch((err: unknown) => {
      logError(`Shutdown error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  });
};

main().catch((err: unknown) => {
  logError(`Daemon failed to start: ${err instanceof Error ? err.message : String(err)}`);
  removePidFile();
  process.exit(1);
});
