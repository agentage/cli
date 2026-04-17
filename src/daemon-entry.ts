import { watch } from 'node:fs';
import { loadConfig, getConfigDir, getAgentsDirs } from './daemon/config.js';
import { logError, logInfo } from './daemon/logger.js';
import { writePidFile, removePidFile } from './daemon/daemon.js';
import { createDaemonServer } from './daemon/server.js';
import { scanAgents } from './discovery/scanner.js';
import { createMarkdownFactory } from './discovery/markdown-factory.js';
import { createCodeFactory } from './discovery/code-factory.js';
import { getHubSync, resetHubSync } from './hub/hub-sync.js';
import { readAuth } from './hub/auth.js';
import { startWatcher } from './discovery/watcher.js';
import { getScheduler, resetScheduler } from './daemon/scheduler.js';
import { createHubClient } from './hub/hub-client.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  logInfo(`Daemon starting (PID ${process.pid})`);
  writePidFile(process.pid);

  const server = createDaemonServer();
  const factories = [createMarkdownFactory(), createCodeFactory()];
  server.setFactories(factories);

  // Initial agent discovery
  const agents = await scanAgents(getAgentsDirs(config), factories);
  server.updateAgents(agents);
  logInfo(`Discovered ${agents.length} agent(s)`);

  await server.start();
  logInfo(`Daemon ready on port ${config.daemon.port}`);

  // Scheduler — fires schedules via the hub /fire endpoint. Initialised
  // before hub-sync so the first heartbeat can reconcile immediately.
  const scheduler = getScheduler(async (s) => {
    const auth = readAuth();
    if (!auth) return null;
    const client = createHubClient(auth.hub.url, auth);
    return client.fireSchedule(s.id, s.nextFireAt);
  });
  await scheduler.start();

  // Initialize hub sync (registers + heartbeat if auth.json exists)
  const hubSync = getHubSync();
  await hubSync.start();

  // Watch discovery dirs for agent file changes
  const stopWatcher = startWatcher(getAgentsDirs(config), async () => {
    try {
      const freshConfig = loadConfig();
      const updatedAgents = await scanAgents(getAgentsDirs(freshConfig), factories);
      server.updateAgents(updatedAgents);
      logInfo(`Watcher rescan: discovered ${updatedAgents.length} agent(s)`);
    } catch (err) {
      logError(`Watcher rescan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Watch for auth.json changes — auto-connect when user logs in
  let authWatchDebounce: ReturnType<typeof setTimeout> | null = null;

  watch(getConfigDir(), (_event, filename) => {
    if (filename !== 'auth.json') return;
    if (authWatchDebounce) clearTimeout(authWatchDebounce);
    authWatchDebounce = setTimeout(async () => {
      const auth = readAuth();
      const currentSync = getHubSync();
      if (auth?.hub?.url && !currentSync.isConnected()) {
        logInfo('Auth changed — connecting to hub...');
        await currentSync.stop();
        resetHubSync();
        const newSync = getHubSync();
        await newSync.start();
      }
    }, 500);
  });

  const shutdown = async (): Promise<void> => {
    logInfo('Daemon shutting down...');
    stopWatcher();
    resetScheduler();
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
