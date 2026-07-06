import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type MemoryClient } from '../lib/memory-client.js';
import { dispatchMemory, isMemoryVerb } from './actions.js';

const LOOPBACK = '127.0.0.1';

export interface DaemonServerOptions {
  getClient: () => MemoryClient | Promise<MemoryClient>;
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

// Loopback-only JSON HTTP: GET /api/health + POST /api/memory/<verb>. No auth (local socket
// trust); the six verbs are the whole surface, dispatched to one shared MemoryClient.
export const createDaemonServer = (opts: DaemonServerOptions): DaemonServer => {
  const startedAt = opts.startedAt ?? Date.now();
  let served = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/api/health') {
      return send(res, 200, {
        ok: true,
        version: opts.version,
        pid: process.pid,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        served,
      });
    }
    const match = url.match(/^\/api\/memory\/([a-z]+)$/);
    if (req.method === 'POST' && match) {
      const verb = match[1];
      if (!isMemoryVerb(verb)) return send(res, 404, { error: `unknown verb: ${verb}` });
      try {
        const result = await dispatchMemory(await opts.getClient(), verb, await readBody(req));
        served += 1;
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
      const onError = (err: NodeJS.ErrnoException): void =>
        reject(err.code === 'EADDRINUSE' ? new Error(`port ${port} already in use`) : err);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

  const stop = (): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

  return { server, start, stop };
};
