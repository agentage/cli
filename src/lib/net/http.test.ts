import { EventEmitter } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchJsonUnref } from './http.js';

// Only https is mocked: the http path runs against a real loopback server below.
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('node:https', () => ({ get: mocks.get }));

let server: Server;
let base = '';
let seen: IncomingHttpHeaders = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    seen = req.headers;
    if (req.url === '/hang') return; // never answers: the timeout must cap it
    const status = req.url === '/missing' ? 404 : 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(req.url === '/garbage' ? 'not json' : JSON.stringify({ path: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('fetchJsonUnref over a real http server', () => {
  it('reads an http: (loopback stub) target instead of throwing on the protocol', async () => {
    const res = await fetchJsonUnref(`${base}/health`, 2000);
    expect(res).toEqual({ ok: true, status: 200, json: { path: '/health' } });
  });

  it('merges the supplied headers with the default Accept', async () => {
    await fetchJsonUnref(`${base}/x`, 2000, { 'X-Agentage-CLI-Version': '9.9.9' });
    expect(seen['accept']).toBe('application/json');
    expect(seen['x-agentage-cli-version']).toBe('9.9.9');
  });

  it('reports a non-2xx status and a malformed body as json:null', async () => {
    expect(await fetchJsonUnref(`${base}/missing`, 2000)).toMatchObject({ ok: false, status: 404 });
    expect(await fetchJsonUnref(`${base}/garbage`, 2000)).toEqual({
      ok: true,
      status: 200,
      json: null,
    });
  });

  it('resolves null when the server never answers within the timeout', async () => {
    const started = Date.now();
    expect(await fetchJsonUnref(`${base}/hang`, 100)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('resolves null on a refused connection, an unsupported protocol, or a bad header', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await fetchJsonUnref(`http://127.0.0.1:${port}/`, 2000)).toBeNull();
    expect(await fetchJsonUnref('ftp://127.0.0.1/x', 2000)).toBeNull();
    expect(await fetchJsonUnref('not a url', 2000)).toBeNull();
    expect(await fetchJsonUnref(`${base}/x`, 2000, { 'X-Bad': 'a\nb' })).toBeNull();
  });
});

describe('fetchJsonUnref over https', () => {
  it('routes an https: URL through node:https and resolves null on its error', async () => {
    mocks.get.mockImplementation(() => {
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => undefined;
      queueMicrotask(() => req.emit('error', new Error('unreachable')));
      return req;
    });
    await expect(fetchJsonUnref('https://192.0.2.1/x', 500)).resolves.toBeNull();
    expect(mocks.get).toHaveBeenCalledOnce();
  });
});
