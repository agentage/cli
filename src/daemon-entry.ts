import { unwatchFile, watchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClientProvider } from './daemon/client-provider.js';
import {
  EADDRINUSE_EXIT_CODE,
  generateDaemonToken,
  removePidFile,
  removePortFile,
  removeTokenFile,
  resolvePort,
  writePidFile,
  writePortFile,
  writeTokenFile,
} from './daemon/lifecycle.js';
import { createDaemonServer } from './daemon/server.js';
import { loadLocalMemoryServer } from './mcp/local-server.js';
import { vaultsJsonPath } from './lib/vault/vaults.js';
import { createDiscoverWatcher } from './sync/discover/watcher.js';
import { createSyncManager } from './sync/git/manager.js';
import { VERSION } from './utils/version.js';

export const isEaddrinuse = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'EADDRINUSE';

// Gate state-file cleanup on ownership: a loser of an autostart race must never wipe the winner's
// pid/port/token files. Only the process that actually wrote them may remove them.
export const createStateCleanup = (
  remove: () => void
): { markOwned: () => void; cleanup: () => void } => {
  let owned = false;
  return {
    markOwned: () => {
      owned = true;
    },
    cleanup: () => {
      if (owned) remove();
    },
  };
};

// Run each reschedule independently: a transiently-invalid config edit must not crash the daemon or
// stop the others rescheduling; the throwing one keeps its last-good schedule.
export const safeReschedule = (steps: Array<() => void>, onError: (msg: string) => void): void => {
  for (const step of steps) {
    try {
      step();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }
};

// MCP is served at /mcp by default; AGENTAGE_DAEMON_NO_MCP=1 leaves buildMcpServer unset so the
// endpoint 404s (the `daemon start --no-mcp` flag sets this on the spawned process).
export const mcpEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env['AGENTAGE_DAEMON_NO_MCP'] !== '1';

// Unset/empty/invalid -> undefined (the watcher's defaults apply); the watcher floors low values.
const envInt = (name: string): number | undefined => {
  const raw = process.env[name];
  if (!raw) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
};

const state = createStateCleanup(() => {
  removePidFile();
  removePortFile();
  removeTokenFile();
});

// The detached, long-lived engine host: one loopback HTTP server that owns a single in-process
// engine and serialises every vault mutation, avoiding concurrent git index.lock collisions. It
// runs the git sync loop and reschedules on config change.
const main = async (): Promise<void> => {
  const port = resolvePort();
  const authToken = generateDaemonToken();
  const git = createSyncManager();
  const discover = createDiscoverWatcher({
    log: (msg) => console.log(`[discover] ${msg}`),
    debounceMs: envInt('AGENTAGE_DISCOVER_DEBOUNCE_MS'),
    pollMs: envInt('AGENTAGE_DISCOVER_POLL_MS'),
  });

  const server = createDaemonServer({
    getClient: createClientProvider(),
    buildMcpServer: mcpEnabled() ? loadLocalMemoryServer : undefined,
    sync: {
      status: () => ({ ...git.status(), discover: discover.status() }),
      runNow: (vault) => git.runNow(vault),
    },
    authToken,
    version: VERSION,
  });
  await server.start(port);
  writePidFile(process.pid);
  writePortFile(port);
  writeTokenFile(authToken);
  state.markOwned();

  const reschedule = (): void =>
    safeReschedule([() => git.reschedule(), () => discover.reschedule()], (msg) =>
      console.error(`[daemon] reschedule failed: ${msg}`)
    );
  reschedule();

  const configPath = vaultsJsonPath();
  watchFile(configPath, { interval: 2000 }, reschedule);

  const shutdown = (): void => {
    unwatchFile(configPath);
    git.stop();
    discover.stop();
    server.stop().finally(() => {
      state.cleanup();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

// Only self-invoke when run directly (spawnDaemon's `node daemon-entry.js`); importing for tests
// must not boot a daemon.
const invokedDirectly = (): boolean => {
  const entry = process.argv[1];
  return !!entry && fileURLToPath(import.meta.url) === entry;
};

if (invokedDirectly()) {
  process.on('uncaughtException', (err: unknown) => {
    console.error(`[daemon] uncaught: ${err instanceof Error ? err.message : String(err)}`);
    state.cleanup();
    process.exit(1);
  });
  main().catch((err: unknown) => {
    if (isEaddrinuse(err)) {
      // Another daemon owns the port + our state files: exit distinctly, touch nothing.
      process.exit(EADDRINUSE_EXIT_CODE);
    }
    console.error(err instanceof Error ? err.message : String(err));
    state.cleanup();
    process.exit(1);
  });
}
