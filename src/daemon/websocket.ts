import { type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { type InvokeEvent, type Run, type RunEvent } from '@agentage/core';
import { onRunEvent, onRunStateChange } from './run-manager.js';
import { getActionRegistry } from './actions.js';
import { logDebug, logInfo } from './logger.js';

interface SubscribeMessage {
  type: 'subscribe';
  runId: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  runId: string;
}

interface InvokeMessage {
  type: 'invoke';
  /** Echoed back on every action_event so clients can multiplex concurrent invocations. */
  requestId: string;
  action: string;
  input?: unknown;
  version?: string;
  idempotencyKey?: string;
  capabilities?: string[];
}

interface CancelInvokeMessage {
  type: 'cancel_invoke';
  requestId: string;
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage | InvokeMessage | CancelInvokeMessage;

const activeInvocations = new Map<string, AbortController>();

const runInvocation = async (ws: WebSocket, msg: InvokeMessage): Promise<void> => {
  const ac = new AbortController();
  activeInvocations.set(msg.requestId, ac);
  try {
    const gen = getActionRegistry().invoke(
      {
        action: msg.action,
        version: msg.version,
        input: msg.input,
        idempotencyKey: msg.idempotencyKey,
        callerId: 'ws',
        capabilities: msg.capabilities ?? ['*'],
      },
      ac.signal
    );
    for await (const event of gen) {
      sendToClient(ws, { type: 'action_event', requestId: msg.requestId, event });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback: InvokeEvent = {
      type: 'error',
      code: 'EXECUTION_FAILED',
      message,
      retryable: true,
    };
    sendToClient(ws, { type: 'action_event', requestId: msg.requestId, event: fallback });
  } finally {
    activeInvocations.delete(msg.requestId);
  }
};

type BufferedMessage =
  | { type: 'run_event'; runId: string; event: RunEvent }
  | { type: 'run_state'; run: Run };

const MAX_BUFFER_PER_RUN = 500;
const BUFFER_TTL_MS = 60_000;

const clientSubscriptions = new Map<WebSocket, Set<string>>();
const runBuffers = new Map<string, BufferedMessage[]>();
const bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();

const bufferMessage = (runId: string, msg: BufferedMessage): void => {
  let buf = runBuffers.get(runId);
  if (!buf) {
    buf = [];
    runBuffers.set(runId, buf);
    // Auto-cleanup after TTL
    const timer = setTimeout(() => {
      runBuffers.delete(runId);
      bufferTimers.delete(runId);
    }, BUFFER_TTL_MS);
    bufferTimers.set(runId, timer);
  }
  if (buf.length >= MAX_BUFFER_PER_RUN) {
    // Ring buffer: drop oldest to make room
    buf.shift();
    logDebug(
      `Buffer overflow for run ${runId} — dropping oldest event (cap: ${MAX_BUFFER_PER_RUN})`
    );
  }
  buf.push(msg);
};

const replayBuffer = (ws: WebSocket, runId: string): void => {
  const buf = runBuffers.get(runId);
  if (!buf) return;

  // B3: Extend TTL when a client subscribes to prevent race between
  // buffer expiry and replay delivery
  const existingTimer = bufferTimers.get(runId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      runBuffers.delete(runId);
      bufferTimers.delete(runId);
    }, BUFFER_TTL_MS);
    bufferTimers.set(runId, timer);
  }

  logDebug(`Replaying ${buf.length} buffered messages for run ${runId}`);
  for (const msg of buf) {
    sendToClient(ws, msg);
  }
};

const sendToClient = (ws: WebSocket, data: unknown): void => {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(data));
  } catch (err) {
    logDebug(`Failed to send WS message: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const setupWebSocket = (server: Server): WebSocketServer => {
  const wss = new WebSocketServer({ server, path: '/ws' });

  onRunEvent((runId: string, event: RunEvent) => {
    const msg: BufferedMessage = { type: 'run_event', runId, event };
    bufferMessage(runId, msg);

    for (const [ws, subs] of clientSubscriptions) {
      if (subs.has(runId)) {
        sendToClient(ws, msg);
      }
    }
  });

  onRunStateChange((run: Run) => {
    const msg: BufferedMessage = { type: 'run_state', run };
    bufferMessage(run.id, msg);

    for (const [ws, subs] of clientSubscriptions) {
      if (subs.has(run.id)) {
        sendToClient(ws, msg);
      }
    }
  });

  wss.on('connection', (ws) => {
    logDebug('WebSocket client connected');
    clientSubscriptions.set(ws, new Set());

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;

        if (msg.type === 'subscribe') {
          clientSubscriptions.get(ws)?.add(msg.runId);
          logDebug(`Client subscribed to run ${msg.runId}`);
          // Replay any buffered events the client missed
          replayBuffer(ws, msg.runId);
        }

        if (msg.type === 'unsubscribe') {
          clientSubscriptions.get(ws)?.delete(msg.runId);
          logDebug(`Client unsubscribed from run ${msg.runId}`);
        }

        if (msg.type === 'invoke') {
          logDebug(`Client invoked action ${msg.action} (${msg.requestId})`);
          void runInvocation(ws, msg);
        }

        if (msg.type === 'cancel_invoke') {
          const ac = activeInvocations.get(msg.requestId);
          if (ac) {
            ac.abort();
            logDebug(`Canceled invocation ${msg.requestId}`);
          }
        }
      } catch {
        logDebug('Invalid WebSocket message received');
      }
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
      logDebug('WebSocket client disconnected');
    });
  });

  logInfo('WebSocket server ready');
  return wss;
};
