import { WebSocket } from 'ws';
import { loadConfig } from '../daemon/config.js';

const getBaseUrl = (): string => {
  const config = loadConfig();
  return `http://localhost:${config.daemon.port}`;
};

const getWsUrl = (): string => {
  const config = loadConfig();
  return `ws://localhost:${config.daemon.port}/ws`;
};

export const get = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${getBaseUrl()}${path}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const post = async <T>(path: string, body?: unknown): Promise<T> =>
  request<T>('POST', path, body);

export const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const connectWs = (onMessage: (data: unknown) => void): WebSocket => {
  const ws = new WebSocket(getWsUrl());
  ws.on('message', (raw) => {
    try {
      const data: unknown = JSON.parse(String(raw));
      onMessage(data);
    } catch {
      // Ignore malformed messages
    }
  });
  return ws;
};
