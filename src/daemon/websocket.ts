import { type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { type Run, type RunEvent } from '@agentage/core';
import { onRunEvent, onRunStateChange } from './run-manager.js';
import { logDebug, logInfo } from './logger.js';

interface SubscribeMessage {
  type: 'subscribe';
  runId: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  runId: string;
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage;

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
    logDebug(`Buffer overflow for run ${runId} — dropping oldest event (cap: ${MAX_BUFFER_PER_RUN})`);
  }
  buf.push(msg);
};

const replayBuffer = (ws: WebSocket, runId: string): void => {
  const buf = runBuffers.get(runId);
  if (!buf) return;
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
