import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

// What a route answers: a JSON body (null included), an empty body, or a 302 to `location`.
export interface Reply {
  status: number;
  body?: unknown;
  location?: string;
}

export const json = (status: number, body: unknown): Reply => ({ status, body });

export const oauthError = (status: number, error: string): Reply => json(status, { error });

export const redirectTo = (base: string, params: Record<string, string>): Reply => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { status: 302, location: url.toString() };
};

export const send = (res: ServerResponse, reply: Reply): void => {
  if (reply.location) {
    res.writeHead(reply.status, { location: reply.location }).end();
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status).end();
    return;
  }
  res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(reply.body));
};

export const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

export const listenLoopback = async (): Promise<{ server: Server; port: number }> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
};

export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
