import { platform, arch } from 'node:os';
import { loadConfig } from '../daemon/config.js';
import { type AuthState, readAuth, saveAuth } from './auth.js';
import { createHubClient, type HubClient } from './hub-client.js';
import { createReconnector, type Reconnector } from './reconnection.js';
import { logInfo, logWarn } from '../daemon/logger.js';
import { getAgents } from '../daemon/routes.js';
import { getRuns } from '../daemon/run-manager.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const DAEMON_VERSION = '0.2.0';

export interface HubSync {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isConnected: () => boolean;
}

export const createHubSync = (): HubSync => {
  let hubClient: HubClient | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnector: Reconnector | null = null;
  let connected = false;

  const register = async (auth: AuthState): Promise<void> => {
    const config = loadConfig();

    hubClient = createHubClient(auth.hub.url, auth);

    const result = await hubClient.register({
      id: config.machine.id,
      name: config.machine.name,
      platform: platform(),
      arch: arch(),
      daemonVersion: DAEMON_VERSION,
    });

    // Save machineId in auth
    auth.hub.machineId = result.machineId;
    saveAuth(auth);

    connected = true;
    logInfo(`Registered with hub as machine ${result.machineId}`);
  };

  const startHeartbeat = (auth: AuthState): void => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    heartbeatTimer = setInterval(async () => {
      if (!hubClient || !connected) return;

      try {
        const agents = getAgents().map((a) => ({
          name: a.manifest.name,
          description: a.manifest.description,
          version: a.manifest.version,
          tags: a.manifest.tags,
        }));

        const activeRunIds = getRuns()
          .filter((r) => r.state === 'working' || r.state === 'submitted')
          .map((r) => r.id);

        const response = await hubClient.heartbeat(auth.hub.machineId, {
          agents,
          activeRunIds,
        });

        // Process pending commands
        if (response.pendingCommands && Array.isArray(response.pendingCommands)) {
          if (response.pendingCommands.length > 0) {
            logInfo(`Received ${response.pendingCommands.length} pending command(s) from hub`);
          }
        }
      } catch (err) {
        logWarn(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  return {
    start: async () => {
      const auth = readAuth();
      if (!auth) {
        logInfo('No auth — running in standalone mode');
        return;
      }

      reconnector = createReconnector({
        onReconnect: async () => {
          await register(auth);
          startHeartbeat(auth);
        },
        onError: (err) => {
          logWarn(
            `Hub connection failed: ${err instanceof Error ? err.message : String(err)}. Retrying...`
          );
        },
      });

      try {
        await register(auth);
        startHeartbeat(auth);
        logInfo(`Connected to hub at ${auth.hub.url}`);
      } catch (err) {
        logWarn(
          `Initial hub connection failed: ${err instanceof Error ? err.message : String(err)}. Will retry.`
        );
        connected = false;
        reconnector.start();
      }
    },

    stop: async () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (reconnector) {
        reconnector.stop();
        reconnector = null;
      }

      if (hubClient && connected) {
        const auth = readAuth();
        if (auth) {
          try {
            await hubClient.deregister(auth.hub.machineId);
            logInfo('Deregistered from hub');
          } catch {
            // Best effort
          }
        }
      }

      connected = false;
      hubClient = null;
    },

    isConnected: () => connected,
  };
};

// Module-level singleton — lazy initialized in daemon-entry
let _hubSync: HubSync | null = null;

export const getHubSync = (): HubSync => {
  if (!_hubSync) {
    _hubSync = createHubSync();
  }
  return _hubSync;
};

export const resetHubSync = (): void => {
  _hubSync = null;
};
