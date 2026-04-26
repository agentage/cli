import { platform, arch } from 'node:os';
import { loadConfig, getDefaultVaultsDir } from '../daemon/config.js';
import { type AuthState, readAuth, saveAuth } from './auth.js';
import { createHubClient, type HubClient } from './hub-client.js';
import { createHubWs, type HubWs } from './hub-ws.js';
import { createReconnector, type Reconnector } from './reconnection.js';
import { logError, logInfo, logWarn } from '../daemon/logger.js';
import { getAgents } from '../daemon/routes.js';
import { cancelRun, sendInput, getRuns } from '../daemon/run-manager.js';
import { getScheduler } from '../daemon/scheduler.js';
import { getActionRegistry } from '../daemon/actions.js';
import { loadProjects } from '../projects/projects.js';
import { getVaultRegistry } from '../vaults/instance.js';

import { collectMachineMetrics } from '../daemon/metrics.js';
import { VERSION } from '../utils/version.js';
import { AuthExpiredError, refreshTokenIfNeeded } from './token-refresh.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface HubSync {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isConnected: () => boolean;
  isConnecting: () => boolean;
  isAuthExpired: () => boolean;
  triggerHeartbeat: () => Promise<void>;
}

export const createHubSync = (): HubSync => {
  let hubClient: HubClient | null = null;
  let hubWs: HubWs | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnector: Reconnector | null = null;
  let connected = false;
  let connecting = false;
  let authExpired = false;

  const markAuthExpired = (err: AuthExpiredError): void => {
    if (authExpired) return;
    authExpired = true;
    connected = false;
    connecting = false;
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    reconnector?.stop();
    logError(`[hub-sync] ${err.message}`);
  };

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

    const config = loadConfig();

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

    let resources: Awaited<ReturnType<typeof collectMachineMetrics>> | undefined;
    try {
      resources = await collectMachineMetrics();
    } catch (err) {
      logWarn(
        `[hub-sync] metrics collection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const actions = getActionRegistry()
      .list()
      .map((m) => ({
        name: m.name,
        version: m.version,
        title: m.title,
        description: m.description,
        scope: m.scope,
        capability: m.capability,
        idempotent: m.idempotent,
        ...(m.inputSchema && { inputSchema: m.inputSchema as Record<string, unknown> }),
        ...(m.deprecatedSince && { deprecatedSince: m.deprecatedSince }),
      }));

    let vaults: Awaited<ReturnType<ReturnType<typeof getVaultRegistry>['metadata']>> = [];
    try {
      vaults = await getVaultRegistry().metadata();
    } catch (err) {
      logWarn(
        `[hub-sync] vault metadata collection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const vaultsDefault = getDefaultVaultsDir(config);

    const response = await hubClient.heartbeat(auth.hub.machineId, {
      agents,
      projects,
      activeRunIds,
      daemonVersion: VERSION,
      agentsDefault: config.agents.default,
      projectsDefault: config.projects.default,
      vaultsDefault,
      actions,
      ...(vaults.length > 0 && { vaults }),
      ...(resources && { resources }),
    });

    // Reconcile local cron registry against the authoritative bindings
    if (response.schedules) {
      try {
        getScheduler().reconcile(response.schedules);
      } catch (err) {
        logWarn(
          `[hub-sync] scheduler reconcile failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Process pending commands from hub
    if (response.pendingCommands && Array.isArray(response.pendingCommands)) {
      for (const cmd of response.pendingCommands as Array<{
        type: string;
        runId?: string;
        payload?: string;
        commandId?: string;
        action?: string;
        version?: string;
        input?: unknown;
        idempotencyKey?: string;
      }>) {
        if (cmd.type === 'cancel' && cmd.runId) {
          cancelRun(cmd.runId);
          logInfo(`Processed pending cancel for run ${cmd.runId}`);
        } else if (cmd.type === 'input' && cmd.runId && cmd.payload) {
          sendInput(cmd.runId, cmd.payload);
          logInfo(`Processed pending input for run ${cmd.runId}`);
        } else if (cmd.type === 'invoke-action' && cmd.commandId && cmd.action) {
          // Heartbeat-drain (hub α.4): the WS-push branch missed this row
          // because the WS was flapping when the user clicked. Hub already
          // marked it 'accepted' on its side, so we just need to execute
          // and stream events back. If the WS isn't open right now we
          // still execute (events get dropped on the floor — hub row
          // ends up stuck 'accepted', operator-visible). Once the WS
          // reconnects, future events from this same dispatch flow back
          // normally. Acceptable for MVP — see daemon-command-bridge §
          // open follow-ups.
          if (!hubWs?.isConnected()) {
            logWarn(
              `[hub-sync] Skipping invoke-action ${cmd.commandId}: WS not connected (will surface as stuck 'accepted' on hub)`
            );
            continue;
          }
          hubWs
            .invokeAction({
              commandId: cmd.commandId,
              action: cmd.action,
              version: cmd.version,
              input: cmd.input,
              idempotencyKey: cmd.idempotencyKey,
            })
            .catch((err) => {
              logError(
                `[hub-sync] invoke-action ${cmd.commandId} dispatch failed: ${err instanceof Error ? err.message : String(err)}`
              );
            });
          logInfo(`Processed pending invoke-action ${cmd.action} (commandId=${cmd.commandId})`);
        }
      }
    }
  };

  const startHeartbeat = (auth: AuthState): void => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);

    const scheduleNext = (): void => {
      heartbeatTimer = setTimeout(async () => {
        try {
          const refresh = await refreshTokenIfNeeded();
          if (!refresh.ok && refresh.terminal) {
            throw new AuthExpiredError(refresh.reason);
          }
          await sendHeartbeat(auth);
        } catch (err) {
          if (err instanceof AuthExpiredError) {
            markAuthExpired(err);
            return; // do not reschedule — terminal
          }
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
          if (err instanceof AuthExpiredError) {
            markAuthExpired(err);
            return { stop: true };
          }
          logWarn(
            `Hub connection failed: ${err instanceof Error ? err.message : String(err)}. Retrying...`
          );
          return undefined;
        },
      });

      try {
        await connectAll(auth);
        startHeartbeat(auth);
        logInfo(`Connected to hub at ${auth.hub.url}`);
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          markAuthExpired(err);
          return;
        }
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
    isAuthExpired: () => authExpired,

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
