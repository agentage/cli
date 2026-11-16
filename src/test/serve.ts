import { createServer, type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';

export interface Served {
  port: number;
  seen: { method: string; url: string; body: unknown }[];
  close: () => Promise<void>;
}

type Answer = (req: IncomingMessage, body: unknown) => [number, unknown];

const bodyOf = async (req: IncomingMessage): Promise<unknown> => {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return text ? JSON.parse(text) : undefined;
};

// A loopback port nothing listens on, for a daemon of a test.
export const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
};

// A loopback server that answers JSON, for the daemon client tests.
export const serve = async (answer: Answer): Promise<Served> => {
  const seen: Served['seen'] = [];
  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body });
      const [status, reply] = answer(req, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof reply === 'string' ? reply : JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { port: (server.address() as AddressInfo).port, seen, close };
};
