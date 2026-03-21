import WebSocket from 'ws';
import { logInfo, logError } from '../daemon/logger.js';
import { getAgents } from '../daemon/routes.js';
import {
  startRun,
  cancelRun,
  sendInput,
  onRunEvent,
  onRunStateChange,
} from '../daemon/run-manager.js';

interface WsExecuteRequest {
  type: 'execute';
  requestId: string;
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

type HubMessage = WsExecuteRequest | WsCancel | WsSendInput;

export interface HubWs {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
}

export const createHubWs = (
  hubUrl: string,
  token: string,
  machineId: string,
  onDisconnect?: () => void
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

    try {
      const runId = await startRun(agent, msg.input.task, msg.input.config, msg.input.context);
      send({ type: 'execute_accepted', requestId: msg.requestId, runId });

      // Subscribe to run events and stream to hub
      const unsubEvent = onRunEvent((eventRunId, event) => {
        if (eventRunId === runId) {
          send({ type: 'run_event', runId, event });
        }
      });

      const unsubState = onRunStateChange((run) => {
        if (run.id === runId) {
          send({ type: 'run_state', runId, state: run.state, error: run.error, stats: run.stats });
        }
      });

      eventUnsubscribers.push(unsubEvent, unsubState);
    } catch (err) {
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
      });

      ws.on('message', handleMessage);

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
  };

  function cleanup(): void {
    for (const unsub of eventUnsubscribers) {
      unsub();
    }
    eventUnsubscribers.length = 0;
  }
};
