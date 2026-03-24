import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type Agent, type RunEvent } from '@agentage/core';
import { type DaemonServer } from './server.js';

const testDir = join(tmpdir(), `agentage-test-server-${Date.now()}`);
let server: DaemonServer;
let port: number;

describe('server', () => {
  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;

    // Write config with a random port to avoid conflicts
    port = 14000 + Math.floor(Math.random() * 1000);
    const { writeFileSync } = await import('node:fs');
    const { randomUUID } = await import('node:crypto');
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        machine: { id: randomUUID(), name: 'test' },
        daemon: { port },
        discovery: { dirs: [] },
        sync: { events: {} },
      })
    );

    const { createDaemonServer } = await import('./server.js');
    server = createDaemonServer();

    // Add a test agent
    const mockAgent: Agent = {
      manifest: { name: 'test-agent', description: 'Test', path: '/test' },
      async run() {
        async function* gen(): AsyncIterable<RunEvent> {
          yield {
            type: 'output',
            data: { type: 'output', content: 'hello', format: 'text' },
            timestamp: Date.now(),
          };
          yield {
            type: 'result',
            data: { type: 'result', success: true },
            timestamp: Date.now(),
          };
        }
        return {
          runId: 'test',
          events: gen(),
          cancel: () => {},
          sendInput: () => {},
        };
      },
    };
    server.updateAgents([mockAgent]);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('GET /api/health returns ok', async () => {
    const res = await fetch(`http://localhost:${port}/api/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.hubConnected).toBe(false);
  });

  it('GET /api/agents returns agent list', async () => {
    const res = await fetch(`http://localhost:${port}/api/agents`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].name).toBe('test-agent');
  });

  it('POST /api/agents/:name/run creates run', async () => {
    const res = await fetch(`http://localhost:${port}/api/agents/test-agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'hello' }),
    });
    const body = (await res.json()) as { runId: string };
    expect(res.status).toBe(200);
    expect(body.runId).toBeDefined();
  });

  it('GET /api/runs returns run list', async () => {
    // Wait for the run from previous test to register
    await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(`http://localhost:${port}/api/runs`);
    const body = (await res.json()) as unknown[];
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/runs/:id returns single run', async () => {
    const runRes = await fetch(`http://localhost:${port}/api/agents/test-agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'test' }),
    });
    const { runId } = (await runRes.json()) as { runId: string };

    const res = await fetch(`http://localhost:${port}/api/runs/${runId}`);
    const body = (await res.json()) as { id: string };
    expect(res.status).toBe(200);
    expect(body.id).toBe(runId);
  });

  it('POST /api/agents/:name/run returns 404 for unknown agent', async () => {
    const res = await fetch(`http://localhost:${port}/api/agents/nonexistent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'hello' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/agents/:name/run returns 400 without task', async () => {
    const res = await fetch(`http://localhost:${port}/api/agents/test-agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/runs/:id returns 404 for unknown run', async () => {
    const res = await fetch(`http://localhost:${port}/api/runs/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('POST /api/runs/:id/cancel returns 400 for unknown run', async () => {
    const res = await fetch(`http://localhost:${port}/api/runs/nonexistent/cancel`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/runs/:id/input returns 400 without text', async () => {
    const res = await fetch(`http://localhost:${port}/api/runs/some-id/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/runs/:id/input returns 400 for invalid run', async () => {
    const res = await fetch(`http://localhost:${port}/api/runs/nonexistent/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agents/refresh returns agent list', async () => {
    const res = await fetch(`http://localhost:${port}/api/agents/refresh`, {
      method: 'POST',
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/hub/machines returns 401 when not logged in', async () => {
    const res = await fetch(`http://localhost:${port}/api/hub/machines`);
    expect(res.status).toBe(401);
  });
});
