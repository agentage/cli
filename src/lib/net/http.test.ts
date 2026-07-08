import { EventEmitter } from 'node:events';
import type { OutgoingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonUnref } from './http.js';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('node:https', () => ({ get: mocks.get }));

describe('fetchJsonUnref', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves null within the timeout bound on an unreachable host', async () => {
    // The mocked get emits an immediate error so the unreachable path resolves null.
    mocks.get.mockImplementation(() => {
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      queueMicrotask(() => req.emit('error', new Error('unreachable')));
      return req;
    });
    await expect(fetchJsonUnref('https://192.0.2.1/x', 500)).resolves.toBeNull();
  });

  it('merges the supplied headers with the default Accept', async () => {
    let captured: OutgoingHttpHeaders | undefined;
    mocks.get.mockImplementation(
      (_url: string, opts: { headers: OutgoingHttpHeaders }, cb: (res: EventEmitter) => void) => {
        captured = opts.headers;
        const res = new EventEmitter() as EventEmitter & {
          setEncoding: () => void;
          statusCode: number;
        };
        res.setEncoding = () => {};
        res.statusCode = 200;
        const req = new EventEmitter() as EventEmitter & { destroy: () => void };
        req.destroy = () => {};
        cb(res);
        queueMicrotask(() => {
          res.emit('data', '{"ok":true}');
          res.emit('end');
        });
        return req;
      }
    );
    const result = await fetchJsonUnref('https://x.example/x', 2000, {
      'X-Agentage-CLI-Version': '9.9.9',
      'User-Agent': 'agentage-cli/9.9.9',
    });
    expect(result).toEqual({ ok: true, status: 200, json: { ok: true } });
    expect(captured).toMatchObject({
      Accept: 'application/json',
      'X-Agentage-CLI-Version': '9.9.9',
      'User-Agent': 'agentage-cli/9.9.9',
    });
  });
});
