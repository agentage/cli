import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, type VaultsConfig } from '@agentage/memory-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalMemoryServer } from '../mcp/local-server.js';
import { isAllowedHost, isAllowedOrigin } from './guards.js';
import { createDaemonServer, type DaemonServer, type DaemonServerOptions } from './server.js';
import { type MemoryClient } from '../lib/memory/memory-client.js';

const TOKEN = 'server-security-token';

const mockClient = (): MemoryClient => ({
  search: vi.fn(async () => ({ results: [] })),
  read: vi.fn(async () => ({
    path: 'a.md',
    title: 'A',
    frontmatter: {},
    body: 'hi',
    tags: [],
    updated: 'now',
    deleted: false,
  })),
  write: vi.fn(async () => ({ path: 'a.md', rev: 'r', updated: 'now' })),
  edit: vi.fn(async () => ({ path: 'a.md', rev: 'r', updated: 'now' })),
  list: vi.fn(async () => ({ folder: '', entries: [], truncated: false, files: 0 })),
  delete: vi.fn(async () => ({ path: 'a.md', deleted: true })),
});

const mcpConfig: VaultsConfig = {
  version: 1,
  default: 'main',
  vaults: { main: { path: join(tmpdir(), 'agentage-security-test'), mcp: ['local'] } },
};

const start = async (
  over: Partial<DaemonServerOptions> = {}
): Promise<{
  port: number;
  srv: DaemonServer;
}> => {
  const srv = createDaemonServer({
    getClient: () => mockClient(),
    buildMcpServer: async () => createLocalMemoryServer(await createRegistry(mcpConfig)),
    authToken: TOKEN,
    version: '9.9.9',
    ...over,
  });
  await srv.start(0);
  const addr = srv.server.address();
  return { port: typeof addr === 'object' && addr ? addr.port : 0, srv };
};

interface RawResponse {
  status: number;
  body: string;
}

const raw = (
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') })
        );
      }
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });

const jsonAuth = { 'content-type': 'application/json', 'x-agentage-token': TOKEN };

let running: DaemonServer | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  vi.restoreAllMocks();
});

describe('loopback origin guards (pure)', () => {
  it('allows only the three loopback hosts at the bound port', () => {
    expect(isAllowedHost('127.0.0.1:4243', 4243)).toBe(true);
    expect(isAllowedHost('localhost:4243', 4243)).toBe(true);
    expect(isAllowedHost('[::1]:4243', 4243)).toBe(true);
    expect(isAllowedHost('127.0.0.1:9999', 4243)).toBe(false);
    expect(isAllowedHost('evil.example', 4243)).toBe(false);
    expect(isAllowedHost(undefined, 4243)).toBe(false);
  });

  it('allows an absent or loopback Origin and rejects a web Origin', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4243')).toBe(true);
    expect(isAllowedOrigin('http://localhost')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://attacker.localhost.evil.com')).toBe(false);
  });
});

describe('daemon HTTP web-origin defense', () => {
  it('403s a mismatched Host header (DNS rebinding)', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, { path: '/api/health', headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  it('403s a non-loopback Origin header', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, {
      path: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('keeps /api/health tokenless under a valid Host', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, { path: '/api/health' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('401s an /api/memory call without the token', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, {
      method: 'POST',
      path: '/api/memory/read',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'a.md' }),
    });
    expect(res.status).toBe(401);
  });

  it('401s an /api/memory call with the wrong token', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, {
      method: 'POST',
      path: '/api/memory/read',
      headers: { 'content-type': 'application/json', 'x-agentage-token': 'nope' },
      body: JSON.stringify({ ref: 'a.md' }),
    });
    expect(res.status).toBe(401);
  });

  it('415s a POST /api/* that is not application/json (browser simple request)', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, {
      method: 'POST',
      path: '/api/memory/write',
      headers: { 'content-type': 'text/plain', 'x-agentage-token': TOKEN },
      body: JSON.stringify({ ref: 'a.md', body: 'x' }),
    });
    expect(res.status).toBe(415);
  });

  it('serves an authenticated JSON /api/memory call', async () => {
    const { port, srv } = await start();
    running = srv;
    const res = await raw(port, {
      method: 'POST',
      path: '/api/memory/read',
      headers: jsonAuth,
      body: JSON.stringify({ ref: 'a.md' }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).path).toBe('a.md');
  });

  it('reports mcp on in /api/health when buildMcpServer is set, off when omitted', async () => {
    const on = await start();
    running = on.srv;
    const onRes = await raw(on.port, { path: '/api/health' });
    expect(JSON.parse(onRes.body).mcp).toBe(true);
    await on.srv.stop();

    const off = await start({ buildMcpServer: undefined });
    running = off.srv;
    const offRes = await raw(off.port, { path: '/api/health' });
    expect(JSON.parse(offRes.body).mcp).toBe(false);
  });

  it('404s /mcp when the endpoint is gated off (--no-mcp)', async () => {
    const { port, srv } = await start({ buildMcpServer: undefined });
    running = srv;
    const res = await raw(port, {
      method: 'POST',
      path: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(404);
  });

  it('leaves /mcp tokenless but Host-validated', async () => {
    const { port, srv } = await start();
    running = srv;
    const init = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    const ok = await raw(port, {
      method: 'POST',
      path: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: init,
    });
    expect(ok.status).toBe(200);
    const badHost = await raw(port, {
      method: 'POST',
      path: '/mcp',
      headers: { host: 'evil.example', 'content-type': 'application/json' },
      body: init,
    });
    expect(badHost.status).toBe(403);
  });
});
