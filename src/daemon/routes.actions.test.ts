import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { type Server } from 'node:http';
import {
  action,
  createRegistry,
  type ActionDefinition,
  type ActionRegistry,
  type InvokeEvent,
} from '@agentage/core';

vi.mock('./config.js', () => ({ loadConfig: vi.fn() }));
vi.mock('./run-manager.js', () => ({
  startRun: vi.fn(),
  getRun: vi.fn(),
  getRuns: vi.fn().mockReturnValue([]),
  cancelRun: vi.fn(),
  sendInput: vi.fn(),
}));
vi.mock('../hub/hub-sync.js', () => ({
  getHubSync: () => ({
    isConnected: () => false,
    isConnecting: () => false,
    isAuthExpired: () => false,
    start: vi.fn(),
    stop: vi.fn(),
    triggerHeartbeat: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../hub/auth.js', () => ({ readAuth: () => null }));
vi.mock('../hub/hub-client.js', () => ({ createHubClient: vi.fn() }));
vi.mock('../utils/version.js', () => ({ VERSION: '0.0.0-test' }));
vi.mock('../projects/projects.js', () => ({ loadProjects: () => [] }));
vi.mock('../discovery/scanner.js', () => ({ getLastScanWarnings: () => [] }));

let testRegistry: ActionRegistry;
vi.mock('./actions.js', () => ({
  getActionRegistry: () => testRegistry,
  resetActionRegistry: vi.fn(),
}));

const echoAction: ActionDefinition<{ msg: string }, { echoed: string }, { step: number }> = action({
  manifest: {
    name: 'test:echo',
    version: '1.0',
    title: 'Echo',
    description: 'Echo a message',
    scope: 'machine',
    capability: 'test.read',
    idempotent: true,
  },
  async *execute(_ctx, input) {
    yield { step: 1 };
    yield { step: 2 };
    return { echoed: input.msg };
  },
});

const parseSse = (text: string): InvokeEvent[] =>
  text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as InvokeEvent);

describe('action routes', () => {
  let server: Server;

  beforeEach(async () => {
    const { loadConfig } = await import('./config.js');
    vi.mocked(loadConfig).mockReturnValue({
      machine: { id: 'm1', name: 'test' },
      daemon: { port: 4243 },
      agents: { default: '/tmp/agents', additional: [] },
      projects: { default: '/tmp/projects', additional: [] },
      sync: { events: {} },
    } as unknown as ReturnType<typeof loadConfig>);

    testRegistry = createRegistry({ idGenerator: () => 'inv-test' });
    testRegistry.register(echoAction);

    const { createRoutes } = await import('./routes.js');
    const app = express();
    app.use(createRoutes());
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const baseUrl = (): string => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `http://localhost:${port}`;
  };

  it('GET /api/actions lists registered manifests', async () => {
    const res = await fetch(`${baseUrl()}/api/actions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ name: 'test:echo', capability: 'test.read' });
  });

  it('POST /api/actions/:name streams accepted → progress → result as SSE', async () => {
    const res = await fetch(`${baseUrl()}/api/actions/test:echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-capabilities': 'test.read' },
      body: JSON.stringify({ input: { msg: 'hello' } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    expect(events).toEqual([
      { type: 'accepted', invocationId: 'inv-test' },
      { type: 'progress', data: { step: 1 } },
      { type: 'progress', data: { step: 2 } },
      { type: 'result', data: { echoed: 'hello' } },
    ]);
  });

  it('emits UNAUTHORIZED error event when x-capabilities omits the required cap', async () => {
    const res = await fetch(`${baseUrl()}/api/actions/test:echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-capabilities': 'other.read' },
      body: JSON.stringify({ input: { msg: 'hi' } }),
    });
    const events = parseSse(await res.text());
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
  });

  it('defaults to wildcard capability when x-capabilities header is absent', async () => {
    const res = await fetch(`${baseUrl()}/api/actions/test:echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { msg: 'hi' } }),
    });
    const events = parseSse(await res.text());
    expect(events.at(-1)).toMatchObject({ type: 'result' });
  });

  it('returns UNKNOWN_ACTION error for unregistered names', async () => {
    const res = await fetch(`${baseUrl()}/api/actions/nope:nope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    const events = parseSse(await res.text());
    expect(events[0]).toMatchObject({ type: 'error', code: 'UNKNOWN_ACTION' });
  });
});
