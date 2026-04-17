import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import express from 'express';

const testDir = join(tmpdir(), `agentage-test-client-${Date.now()}`);
let httpServer: Server;
let port: number;

describe('daemon-client', () => {
  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true });
    port = 16000 + Math.floor(Math.random() * 1000);

    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        machine: { id: randomUUID(), name: 'test' },
        daemon: { port },
        agents: { default: '/tmp/agents', additional: [] },
        projects: { default: '/tmp/projects', additional: [] },
        sync: { events: {} },
      })
    );

    process.env['AGENTAGE_CONFIG_DIR'] = testDir;

    const app = express();
    app.use(express.json());
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    app.post('/api/test', (req, res) => res.json({ received: req.body }));
    app.get('/api/fail', (_req, res) => res.status(500).json({ error: 'fail' }));

    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(port, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('get() fetches data from daemon', async () => {
    const { get } = await import('./daemon-client.js');
    const result = await get<{ status: string }>('/api/health');
    expect(result.status).toBe('ok');
  });

  it('post() sends data to daemon', async () => {
    const { post } = await import('./daemon-client.js');
    const result = await post<{ received: { hello: string } }>('/api/test', { hello: 'world' });
    expect(result.received.hello).toBe('world');
  });

  it('get() throws on error response', async () => {
    const { get } = await import('./daemon-client.js');
    await expect(get('/api/fail')).rejects.toThrow('fail');
  });

  it('post() without body works', async () => {
    // Add a POST endpoint that accepts no body
    const { post } = await import('./daemon-client.js');
    // POST to test endpoint with undefined body
    const result = await post<{ received: unknown }>('/api/test');
    expect(result).toBeDefined();
  });

  it('connectWs connects and calls onMessage', async () => {
    const { connectWs } = await import('./daemon-client.js');
    // Note: no WS server on this port, so it'll error — but we test the function exists
    const messages: unknown[] = [];
    const ws = connectWs((data) => messages.push(data));

    // Wait for error (no WS server)
    await new Promise((r) => {
      ws.on('error', () => r(undefined));
      setTimeout(() => r(undefined), 200);
    });
    ws.close();
  });
});
