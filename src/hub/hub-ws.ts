import WebSocket from 'ws';
import type { Run, RunEvent } from '@agentage/core';
import { logInfo, logError } from '../daemon/logger.js';
import { getAgents } from '../daemon/routes.js';
import {
  startRun,
  cancelRun,
  sendInput,
  onRunEvent,
  onRunStateChange,
  onRunStarted,
} from '../daemon/run-manager.js';
import { dispatchInvokeAction, type InvokeActionCommand } from './command-dispatch.js';

interface WsExecuteRequest {
  type: 'execute';
  requestId: string;
  runId?: string;
  agentName: string;
  input: { task: string; config?: Record<string, unknown>; context?: string[] };
}

interface WsCancel {
  type: 'cancel';
  runId: string;
}

interface WsSendInput {
  type: 'input';
  runId: string;
  text: string;
}

interface WsInvokeAction {
  type: 'invoke-action';
  commandId: string;
  action: string;
  version?: string;
  input: unknown;
  idempotencyKey?: string;
}

type HubMessage = WsExecuteRequest | WsCancel | WsSendInput | WsInvokeAction;

export interface HubWs {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
  // Heartbeat-drained invoke-actions (hub-sync.ts) reuse the same dispatch
  // path so the per-WS `send` closure routes command_event frames back over
  // the live WS. No-op-equivalent when the WS isn't open — caller checks
  // isConnected() before delegating.
  invokeAction: (cmd: InvokeActionCommand) => Promise<void>;
}

export const createHubWs = (
  hubUrl: string,
  token: string,
  machineId: string,
  onDisconnect?: () => void,
  onConnect?: () => void
): HubWs => {
  let ws: WebSocket | null = null;
  let connected = false;
  const eventUnsubscribers: Array<() => void> = [];

  const send = (message: unknown): void => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const handleExecute = async (msg: WsExecuteRequest): Promise<void> => {
    const agents = getAgents();
    const agent = agents.find((a) => a.manifest.name === msg.agentName);

    if (!agent) {
      send({ type: 'execute_rejected', requestId: msg.requestId, reason: 'Agent not found' });
      return;
    }

    // Listeners must be attached BEFORE awaiting startRun. run-manager fires
    // its first state transition ('submitted' → 'working') and may stream
    // result/completed events synchronously inside startRun for fast agents
    // (e.g. shell echo). If we wait for startRun to resolve before subscribing,
    // those terminal events are missed and the hub's runs row is stuck at
    // 'working' forever. See e2e#46.
    //
    // Because we don't yet know the localRunId at subscription time, we buffer
    // any events received before startRun resolves and replay them once the id
    // is known.
    const TERMINAL_STATES = ['completed', 'failed', 'canceled'];
    const unsubs: Array<() => void> = [];
    let localRunId: string | null = null;
    const pendingEvents: Array<{ eventRunId: string; event: RunEvent }> = [];
    const pendingStates: Run[] = [];

    const cleanupRunListeners = (): void => {
      for (const fn of unsubs) fn();
      unsubs.length = 0;
    };

    unsubs.push(
      onRunEvent((eventRunId, event) => {
        if (localRunId === null) {
          pendingEvents.push({ eventRunId, event });
          return;
        }
        if (eventRunId === localRunId) {
          send({ type: 'run_event', runId: msg.runId ?? localRunId, event });
        }
      })
    );

    unsubs.push(
      onRunStateChange((run) => {
        if (localRunId === null) {
          pendingStates.push(run);
          return;
        }
        if (run.id === localRunId) {
          send({
            type: 'run_state',
            runId: msg.runId ?? localRunId,
            state: run.state,
            error: run.error,
            stats: run.stats,
          });
          if (TERMINAL_STATES.includes(run.state)) cleanupRunListeners();
        }
      })
    );

    eventUnsubscribers.push(cleanupRunListeners);

    try {
      localRunId = await startRun(agent, msg.input.task, msg.input.config, msg.input.context);
      // Use hub's runId for all messages back to hub, local ID for matching events
      const hubRunId = msg.runId ?? localRunId;
      send({ type: 'execute_accepted', requestId: msg.requestId, runId: hubRunId });

      // Drain anything that arrived before localRunId was known.
      for (const { eventRunId, event } of pendingEvents) {
        if (eventRunId === localRunId) {
          send({ type: 'run_event', runId: hubRunId, event });
        }
      }
      pendingEvents.length = 0;
      for (const run of pendingStates) {
        if (run.id === localRunId) {
          send({
            type: 'run_state',
            runId: hubRunId,
            state: run.state,
            error: run.error,
            stats: run.stats,
          });
          if (TERMINAL_STATES.includes(run.state)) cleanupRunListeners();
        }
      }
      pendingStates.length = 0;
    } catch (err) {
      cleanupRunListeners();
      send({
        type: 'execute_rejected',
        requestId: msg.requestId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleMessage = (data: WebSocket.Data): void => {
    try {
      const msg = JSON.parse(data.toString()) as HubMessage;

      switch (msg.type) {
        case 'execute':
          handleExecute(msg).catch((err) => {
            logError(`Execute handler error: ${err instanceof Error ? err.message : String(err)}`);
          });
          break;

        case 'cancel':
          cancelRun(msg.runId);
          logInfo(`Hub requested cancel for run ${msg.runId}`);
          break;

        case 'input':
          sendInput(msg.runId, msg.text);
          logInfo(`Hub sent input for run ${msg.runId}`);
          break;

        case 'invoke-action':
          dispatchInvokeAction(msg, send).catch((err) => {
            logError(
              `Invoke-action handler error: ${err instanceof Error ? err.message : String(err)}`
            );
          });
          break;
      }
    } catch {
      logError('[hub-ws] Failed to parse message from hub');
    }
  };

  return {
    connect: () => {
      const wsUrl = hubUrl.replace(/^http/, 'ws');
      const url = `${wsUrl}/ws?token=${encodeURIComponent(token)}&machineId=${encodeURIComponent(machineId)}`;

      ws = new WebSocket(url);

      ws.on('open', () => {
        connected = true;
        logInfo('[hub-ws] Connected to hub');
        onConnect?.();
      });

      ws.on('message', handleMessage);

      // Relay child runs created by ctx.run() — the daemon starts them
      // internally (no `execute` from hub), so we register their lineage and
      // forward their events/state using the daemon-generated runId.
      const unsubStarted = onRunStarted((run) => {
        if (!run.parentRunId) return; // only mirror ctx.run children
        send({
          type: 'run_started',
          runId: run.id,
          agentName: run.agentName,
          input: run.input,
          parentRunId: run.parentRunId,
          depth: run.depth ?? 1,
          createdAt: run.createdAt,
        });

        const TERMINAL_STATES = ['completed', 'failed', 'canceled'];
        const unsubs: Array<() => void> = [];
        const cleanupChildListeners = (): void => {
          for (const fn of unsubs) fn();
          unsubs.length = 0;
        };
        unsubs.push(
          onRunEvent((eventRunId, event) => {
            if (eventRunId === run.id) {
              send({ type: 'run_event', runId: run.id, event });
            }
          })
        );
        unsubs.push(
          onRunStateChange((child) => {
            if (child.id !== run.id) return;
            send({
              type: 'run_state',
              runId: run.id,
              state: child.state,
              error: child.error,
              stats: child.stats,
            });
            if (TERMINAL_STATES.includes(child.state)) cleanupChildListeners();
          })
        );
        eventUnsubscribers.push(cleanupChildListeners);
      });
      eventUnsubscribers.push(unsubStarted);

      ws.on('close', () => {
        connected = false;
        logInfo('[hub-ws] Disconnected from hub');
        cleanup();
        onDisconnect?.();
      });

      ws.on('error', (err) => {
        logError(`[hub-ws] Error: ${err.message}`);
      });
    },

    disconnect: () => {
      cleanup();
      if (ws) {
        ws.close();
        ws = null;
      }
      connected = false;
    },

    isConnected: () => connected,

    invokeAction: (cmd) => dispatchInvokeAction(cmd, send),
  };

  function cleanup(): void {
    for (const unsub of eventUnsubscribers) {
      unsub();
    }
    eventUnsubscribers.length = 0;
  }
};
