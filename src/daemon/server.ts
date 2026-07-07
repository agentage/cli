import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type MemoryClient } from '../lib/memory-client.js';
import { type SyncResult } from '../sync/git/cycle.js';
import { type CouchSyncResult } from '../sync/couch/manager.js';
import { type SyncStatus } from '../sync/git/manager.js';
import { dispatchMemory, isMemoryVerb, type MemoryVerb } from './actions.js';
import { isAllowedHost, isAllowedOrigin, loopbackHosts } from './guards.js';
import { handleMcp } from './mcp-http.js';

const LOOPBACK = '127.0.0.1';
const AUTH_HEADER = 'x-agentage-token';

export interface DaemonSyncApi {
  status: () => SyncStatus;
  // A git vault yields a SyncResult, an account vault a CouchSyncResult - the caller branches.
  runNow: (vault: string) => Promise<SyncResult | CouchSyncResult>;
}

export interface DaemonServerOptions {
  getClient: () => MemoryClient | Promise<MemoryClient>;
  // Builds a fresh MCP server per request for POST /mcp; omit to leave the endpoint unmounted.
  buildMcpServer?: () => Promise<McpServer>;
  // The git-sync surface: GET /api/sync/status + POST /api/sync/run; omit to leave both unmounted.
  sync?: DaemonSyncApi;
  // Fired after a successful write/edit/delete so the account channel can push-on-save. Never
  // awaited: a couch failure must not affect the memory API response.
  onMutation?: (verb: MemoryVerb, body: unknown) => void;
  // Per-daemon secret required on X-Agentage-Token for every /api/* call except /api/health.
  authToken: string;
  version: string;
  startedAt?: number;
}

export interface DaemonServer {
  server: Server;
  start: (port: number, host?: string) => Promise<void>;
  stop: () => Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw.length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const isJsonContentType = (req: IncomingMessage): boolean =>
  (req.headers['content-type'] ?? '').split(';')[0]?.trim() === 'application/json';

const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

// Loopback-only JSON HTTP: GET /api/health + POST /api/memory/<verb> (the CLI verbs) + POST /mcp
// (the frozen 6 tools for on-machine AI clients, stateless Streamable HTTP). Web-origin defense on
// EVERY request (Host + Origin allow-lists + DNS-rebinding protection on /mcp); /api/* additionally
// needs the per-daemon token, while /health and /mcp stay tokenless for probes and editor clients.
export const createDaemonServer = (opts: DaemonServerOptions): DaemonServer => {
  const startedAt = opts.startedAt ?? Date.now();
  let served = 0;
  let boundPort = 0;

  // 403 unless the request looks like it came from a genuine same-machine loopback client.
  const originGuard = (req: IncomingMessage): boolean =>
    isAllowedHost(header(req, 'host'), boundPort) && isAllowedOrigin(header(req, 'origin'));

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    if (!originGuard(req)) return send(res, 403, { error: 'forbidden' });
    const path = url.split('?')[0] ?? url;
    const isApi = path.startsWith('/api/') && path !== '/api/health';
    if (isApi && header(req, AUTH_HEADER) !== opts.authToken) {
      return send(res, 401, { error: 'unauthorized' });
    }
    if (isApi && req.method === 'POST' && !isJsonContentType(req)) {
      return send(res, 415, { error: 'unsupported media type' });
    }
    if (req.method === 'GET' && url === '/api/health') {
      return send(res, 200, {
        ok: true,
        version: opts.version,
        pid: process.pid,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        served,
      });
    }
    if (path === '/mcp') {
      if (!opts.buildMcpServer) return send(res, 404, { error: 'not found' });
      return handleMcp(req, res, opts.buildMcpServer, loopbackHosts(boundPort));
    }
    if (req.method === 'GET' && url === '/api/sync/status') {
      if (!opts.sync) return send(res, 404, { error: 'not found' });
      return send(res, 200, opts.sync.status());
    }
    if (req.method === 'POST' && url === '/api/sync/run') {
      if (!opts.sync) return send(res, 404, { error: 'not found' });
      const body = (await readBody(req)) as { vault?: string };
      if (!body.vault) return send(res, 400, { error: 'vault is required' });
      try {
        return send(res, 200, await opts.sync.runNow(body.vault));
      } catch (err) {
        return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    const match = url.match(/^\/api\/memory\/([a-z]+)$/);
    if (req.method === 'POST' && match) {
      const verb = match[1];
      if (!isMemoryVerb(verb)) return send(res, 404, { error: `unknown verb: ${verb}` });
      try {
        const body = await readBody(req);
        const result = await dispatchMemory(await opts.getClient(), verb, body);
        served += 1;
        opts.onMutation?.(verb, body); // fire-and-forget account push-on-save
        return send(res, 200, result);
      } catch (err) {
        return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    send(res, 404, { error: 'not found' });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) =>
      send(res, 500, { error: err instanceof Error ? err.message : String(err) })
    );
  });

  const start = (port: number, host: string = LOOPBACK): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code !== 'EADDRINUSE') return reject(err);
        // Preserve the code so the entry point can exit distinctly on a busy port.
        const busy = new Error(`port ${port} already in use`) as NodeJS.ErrnoException;
        busy.code = 'EADDRINUSE';
        reject(busy);
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        const addr = server.address();
        boundPort = typeof addr === 'object' && addr ? addr.port : port;
        server.removeListener('error', onError);
        resolve();
      });
    });

  // close() alone hangs on idle keep-alive sockets; drop idle ones now, force the rest after a grace.
  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeIdleConnections();
      const grace = setTimeout(() => server.closeAllConnections(), 500);
      grace.unref();
      server.close(() => {
        clearTimeout(grace);
        resolve();
      });
    });

  return { server, start, stop };
};
