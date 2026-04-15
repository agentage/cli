import { platform, arch } from 'node:os';
import { loadConfig } from '../daemon/config.js';
import { type AuthState, readAuth, saveAuth } from './auth.js';
import { createHubClient, type HubClient } from './hub-client.js';
import { createHubWs, type HubWs } from './hub-ws.js';
import { createReconnector, type Reconnector } from './reconnection.js';
import { logInfo, logWarn } from '../daemon/logger.js';
import { getAgents } from '../daemon/routes.js';
import { cancelRun, sendInput, getRuns } from '../daemon/run-manager.js';
import { loadProjects } from '../projects/projects.js';

import { VERSION } from '../utils/version.js';
import { refreshTokenIfNeeded } from './token-refresh.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface HubSync {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isConnected: () => boolean;
  isConnecting: () => boolean;
  triggerHeartbeat: () => Promise<void>;
}

export const createHubSync = (): HubSync => {
  let hubClient: HubClient | null = null;
  let hubWs: HubWs | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnector: Reconnector | null = null;
  let connected = false;
  let connecting = false;

  const connectAll = async (auth: AuthState): Promise<void> => {
    const config = loadConfig();

    hubClient = createHubClient(auth.hub.url, auth);

    const result = await hubClient.register({
      id: config.machine.id,
      name: config.machine.name,
      platform: platform(),
      arch: arch(),
      daemonVersion: VERSION,
    });

    // Save machineId in auth
    auth.hub.machineId = result.machineId;
    saveAuth(auth);

    logInfo(`Registered with hub as machine ${result.machineId}`);

    // Connect WebSocket
    connecting = true;
    hubWs = createHubWs(
      auth.hub.url,
      auth.session.access_token,
      auth.hub.machineId,
      () => {
        // On disconnect — trigger reconnection
        connected = false;
        connecting = true;
        logWarn('[hub-sync] WS disconnected, will reconnect via heartbeat');
        reconnector?.start();
      },
      () => {
        // On connect — mark as connected
        connected = true;
        connecting = false;
      }
    );

    hubWs.connect();
  };

  const sendHeartbeat = async (auth: AuthState): Promise<void> => {
    if (!hubClient) return;

    const agents = getAgents().map((a) => ({
      name: a.manifest.name,
      description: a.manifest.description,
      version: a.manifest.version,
      tags: a.manifest.tags,
      ...(a.manifest.inputSchema && { inputSchema: a.manifest.inputSchema }),
      ...((a.manifest as { outputSchema?: Record<string, unknown> }).outputSchema && {
        outputSchema: (a.manifest as { outputSchema?: Record<string, unknown> }).outputSchema,
      }),
    }));

    const projects = loadProjects().map((p) => ({
      name: p.name,
      path: p.path,
      discovered: p.discovered,
      ...(p.remote && { remote: p.remote }),
    }));

    const activeRunIds = getRuns()
      .filter((r) => r.state === 'working' || r.state === 'submitted')
      .map((r) => r.id);

    const response = await hubClient.heartbeat(auth.hub.machineId, {
      agents,
      projects,
      activeRunIds,
      daemonVersion: VERSION,
    });

    // Process pending commands from hub
    if (response.pendingCommands && Array.isArray(response.pendingCommands)) {
      for (const cmd of response.pendingCommands as Array<{
        type: string;
        runId: string;
        payload?: string;
      }>) {
        if (cmd.type === 'cancel') {
          cancelRun(cmd.runId);
          logInfo(`Processed pending cancel for run ${cmd.runId}`);
        } else if (cmd.type === 'input' && cmd.payload) {
          sendInput(cmd.runId, cmd.payload);
          logInfo(`Processed pending input for run ${cmd.runId}`);
        }
      }
    }
  };

  const startHeartbeat = (auth: AuthState): void => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);

    const scheduleNext = (): void => {
      heartbeatTimer = setTimeout(async () => {
        try {
          await refreshTokenIfNeeded();
          await sendHeartbeat(auth);
        } catch (err) {
          logWarn(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Schedule next heartbeat AFTER current one finishes (no overlap)
        scheduleNext();
      }, HEARTBEAT_INTERVAL_MS);
    };

    scheduleNext();
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
          await connectAll(auth);
          startHeartbeat(auth);
        },
        onError: (err) => {
          logWarn(
            `Hub connection failed: ${err instanceof Error ? err.message : String(err)}. Retrying...`
          );
        },
      });

      try {
        await connectAll(auth);
        startHeartbeat(auth);
        logInfo(`Connected to hub at ${auth.hub.url}`);
      } catch (err) {
        logWarn(
          `Initial hub connection failed: ${err instanceof Error ? err.message : String(err)}. Will retry.`
        );
        connected = false;
        connecting = false;
        reconnector.start();
      }
    },

    stop: async () => {
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (reconnector) {
        reconnector.stop();
        reconnector = null;
      }

      if (hubWs) {
        hubWs.disconnect();
        hubWs = null;
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
      connecting = false;
      hubClient = null;
    },

    isConnected: () => connected,
    isConnecting: () => connecting,

    triggerHeartbeat: async () => {
      const auth = readAuth();
      if (!auth || !hubClient) return;
      try {
        await sendHeartbeat(auth);
      } catch (err) {
        logWarn(`Manual heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
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
