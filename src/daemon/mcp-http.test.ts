import { createRegistry, type VaultsConfig } from '@agentage/memory-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalMemoryServer } from '../mcp/local-server.js';
import { createDaemonServer, type DaemonServer } from './server.js';

const config: VaultsConfig = {
  version: 1,
  default: 'main',
  vaults: { main: { path: join(tmpdir(), 'agentage-mcp-http-test'), mcp: ['local'] } },
};

const start = async (): Promise<{ port: number; srv: DaemonServer }> => {
  const srv = createDaemonServer({
    getClient: () => {
      throw new Error('memory verbs not used in this test');
    },
    buildMcpServer: async () => createLocalMemoryServer(await createRegistry(config)),
    version: '9.9.9',
  });
  await srv.start(0);
  const addr = srv.server.address();
  return { port: typeof addr === 'object' && addr ? addr.port : 0, srv };
};

const rpc = async (
  port: number,
  body: unknown
): Promise<{ status: number; json: { result?: Record<string, unknown> } }> => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { result?: Record<string, unknown> } };
};

let running: DaemonServer | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

describe('daemon POST /mcp (stateless Streamable HTTP)', () => {
  it('answers initialize with the frozen server identity + instructions', async () => {
    const { port, srv } = await start();
    running = srv;
    const { status, json } = await rpc(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    expect(status).toBe(200);
    expect((json.result?.serverInfo as { name: string }).name).toBe('agentage-memory');
    expect(typeof json.result?.instructions).toBe('string');
    expect((json.result?.instructions as string).length).toBeGreaterThan(0);
  });

  it('lists the frozen six tools', async () => {
    const { port, srv } = await start();
    running = srv;
    const { json } = await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = json.result?.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'memory__delete',
      'memory__edit',
      'memory__list',
      'memory__read',
      'memory__search',
      'memory__write',
    ]);
  });

  it('rejects GET with 405 (stateless, POST only)', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('leaves /mcp unmounted (404) when no builder is supplied', async () => {
    const srv = createDaemonServer({
      getClient: () => {
        throw new Error('unused');
      },
      version: '9.9.9',
    });
    await srv.start(0);
    running = srv;
    const addr = srv.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(404);
  });
});
