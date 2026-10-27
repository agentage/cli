import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cliFetch, isRedirect } from './fetch.js';
import { VERSION } from '../../utils/version.js';

let server: Server;
let base = '';
let hits: string[] = [];
let seen: IncomingHttpHeaders = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    seen = req.headers;
    if (req.url === '/hang') return; // never answers
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/target' }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  hits = [];
  vi.unstubAllGlobals();
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('cliFetch', () => {
  it('sends the CLI identification headers alongside the caller headers', async () => {
    const res = await cliFetch(`${base}/x`, { headers: { authorization: 'Bearer t' } });
    expect(await res.json()).toEqual({ ok: true });
    expect(seen['user-agent']).toBe(`agentage-cli/${VERSION}`);
    expect(seen['x-agentage-cli-version']).toBe(VERSION);
    expect(seen['authorization']).toBe('Bearer t');
  });

  it('refuses to follow a redirect: the 3xx comes back and the target is never hit', async () => {
    const res = await cliFetch(`${base}/redirect`, { method: 'POST', body: 'a=b' });
    expect(res.status).toBe(302);
    expect(isRedirect(res)).toBe(true);
    expect(hits).toEqual(['/redirect']);
  });

  it('aborts a request the server never answers once the timeout fires', async () => {
    const started = Date.now();
    await expect(cliFetch(`${base}/hang`, {}, { timeoutMs: 50 })).rejects.toThrow(/abort|timeout/i);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('keeps the fetch captured at load even when globalThis.fetch is swapped later', async () => {
    const swapped = vi.fn();
    vi.stubGlobal('fetch', swapped);
    const res = await cliFetch(`${base}/x`);
    expect(res.status).toBe(200);
    expect(swapped).not.toHaveBeenCalled();
  });
});

describe('isRedirect', () => {
  it('is true for 3xx only', () => {
    expect(isRedirect(new Response(null, { status: 301 }))).toBe(true);
    expect(isRedirect(new Response(null, { status: 200 }))).toBe(false);
    expect(isRedirect(new Response(null, { status: 404 }))).toBe(false);
  });
});
