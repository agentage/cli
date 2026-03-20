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

const clientSubscriptions = new Map<WebSocket, Set<string>>();

const sendToClient = (ws: WebSocket, data: unknown): void => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
};

export const setupWebSocket = (server: Server): WebSocketServer => {
  const wss = new WebSocketServer({ server, path: '/ws' });

  onRunEvent((runId: string, event: RunEvent) => {
    for (const [ws, subs] of clientSubscriptions) {
      if (subs.has(runId)) {
        sendToClient(ws, { type: 'run_event', runId, event });
      }
    }
  });

  onRunStateChange((run: Run) => {
    for (const [ws, subs] of clientSubscriptions) {
      if (subs.has(run.id)) {
        sendToClient(ws, { type: 'run_state', run });
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
