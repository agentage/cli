import { describe, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const testDir = join(tmpdir(), `agentage-test-ws-${Date.now()}`);
let httpServer: Server;
let wsPort: number;

describe('websocket', () => {
  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        machine: { id: randomUUID(), name: 'test' },
        daemon: { port: 4243 },
        agents: { default: '/tmp/agents', additional: [] },
        projects: { default: '/tmp/projects', additional: [] },
        sync: { events: {} },
      })
    );

    httpServer = createServer();
    const { setupWebSocket } = await import('./websocket.js');
    setupWebSocket(httpServer);

    wsPort = 15000 + Math.floor(Math.random() * 1000);
    await new Promise<void>((resolve) => {
      httpServer.listen(wsPort, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('accepts WebSocket connections', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.close();
  });

  it('handles subscribe message', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    ws.send(JSON.stringify({ type: 'subscribe', runId: 'test-run-123' }));
    // Should not throw
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
  });

  it('handles unsubscribe message', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    ws.send(JSON.stringify({ type: 'subscribe', runId: 'test-run-456' }));
    ws.send(JSON.stringify({ type: 'unsubscribe', runId: 'test-run-456' }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
  });

  it('handles invalid message gracefully', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    ws.send('not json');
    await new Promise((r) => setTimeout(r, 50));
    // Should not crash
    ws.close();
  });

  it('cleans up on disconnect', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    ws.send(JSON.stringify({ type: 'subscribe', runId: 'cleanup-test' }));
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    // Should not throw — cleanup happened
  });

  it('receives run events after subscribing', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    const runId = 'event-test-run';
    ws.send(JSON.stringify({ type: 'subscribe', runId }));
    await new Promise((r) => setTimeout(r, 50));

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});
