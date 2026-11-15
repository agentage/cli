import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { serve, type Served } from '../../test/serve.js';
import { hostClient } from './host-client.js';

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const fail = (code: string, message: string) => ({ success: false, error: { code, message } });

describe('the C5 client of the daemon', () => {
  it('sends each route and gives the data of the envelope', async () => {
    served = await serve((req) => [req.method === 'POST' ? 201 : 200, { success: true, data: 1 }]);
    const host = hostClient(served.port);
    await host.list();
    await host.add({ id: 'probe', version: '0.7.0' });
    await host.change('probe', { enabled: false });
    expect(await host.remove('probe', true)).toBe(1);
    await host.remove('probe', false);
    expect(served.seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /host/extensions',
      'POST /host/extensions',
      'PATCH /host/extensions/probe',
      'DELETE /host/extensions/probe?purge=true',
      'DELETE /host/extensions/probe',
    ]);
    expect(served.seen[1]?.body).toEqual({ id: 'probe', version: '0.7.0' });
  });

  it('passes the error code of the daemon through unchanged', async () => {
    const replies: [number, unknown][] = [
      [404, fail('NOT_FOUND', 'nope is not installed')],
      [409, fail('CONFLICT', 'probe is installed')],
      [500, 'not json'],
    ];
    served = await serve(() => replies.shift() ?? [500, {}]);
    const host = hostClient(served.port);
    await expect(host.remove('nope', false)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'nope is not installed',
    });
    await expect(host.add({ id: 'probe' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(host.list()).rejects.toMatchObject({ code: 'error', message: 'HTTP 500' });
  });

  it('a daemon that does not answer is daemon_unavailable', async () => {
    served = await serve(() => [200, {}]);
    const { port } = served;
    await served.close();
    served = undefined;
    await expect(hostClient(port).list()).rejects.toMatchObject({ code: 'daemon_unavailable' });
  });

  it('a daemon that takes too long is timeout; a change may still finish, and says how to look', async () => {
    const silent = createServer(() => undefined);
    await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));
    const { port } = silent.address() as AddressInfo;
    const host = hostClient(port, { read: 100, change: 200 });
    await expect(host.list()).rejects.toMatchObject({
      code: 'timeout',
      message: `the daemon on 127.0.0.1:${port} did not answer in 0.1 s; agentage daemon status`,
    });
    await expect(host.add({ id: 'probe' })).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringMatching(/in 0\.2 s; it may still finish: agentage extension list$/),
    });
    silent.closeAllConnections();
    await new Promise((done) => silent.close(done));
  });
});
