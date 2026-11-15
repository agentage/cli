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

  const env = (code: string, message: string, details?: object) => ({
    success: false,
    error: { code, message, ...(details && { details }) },
  });
  const STATUS = 'agentage daemon status';
  const ANSWERS: [string, number, object, string, string][] = [
    [
      '409 installed: the details pass',
      409,
      env('CONFLICT', 'probe is installed', { id: 'probe', version: '0.6.2' }),
      'CONFLICT',
      'probe is installed',
    ],
    [
      '409 the installer still runs',
      409,
      env('CONFLICT', 'the installer of probe still runs', {
        op: 'install',
        id: 'probe',
        since: 't',
        timedOut: true,
      }),
      'CONFLICT',
      `the installer of probe still runs; ${STATUS} shows it under pending; try again when it ends`,
    ],
    [
      '409 installation.json unreadable',
      409,
      env(
        'INSTALLATION_UNREADABLE',
        'installation.json cannot be read (EACCES): fix it; no change is written',
        { reason: 'EACCES' }
      ),
      'INSTALLATION_UNREADABLE',
      `installation.json cannot be read (EACCES): fix it; no change is written; ${STATUS} shows the reason`,
    ],
    [
      '409 another daemon',
      409,
      env('DAEMON_RUNNING', 'a daemon (process 7) runs on /c: change it through it'),
      'DAEMON_RUNNING',
      'a daemon (process 7) runs on /c: change it through it',
    ],
    [
      '503 a locked file',
      503,
      env('UNAVAILABLE', 'settings.json is locked by process 7: waited 5000 ms'),
      'UNAVAILABLE',
      'settings.json is locked by process 7: waited 5000 ms; try again',
    ],
    [
      '503 the daemon stops',
      503,
      env('UNAVAILABLE', 'the daemon stops'),
      'UNAVAILABLE',
      'the daemon stops; try again',
    ],
    [
      '503 a queue that waited: no second try again',
      503,
      env('UNAVAILABLE', 'other changes ran for 5 ms: try again'),
      'UNAVAILABLE',
      'other changes ran for 5 ms: try again',
    ],
    [
      '504 the installer timed out',
      504,
      env('TIMEOUT', 'the installer did not answer in 600000 ms'),
      'TIMEOUT',
      `the installer did not answer in 600000 ms; the daemon recorded nothing: when ${STATUS} no longer shows it under pending, run the command again (a download that finished is reused)`,
    ],
  ];

  it.each(ANSWERS)(
    '%s: one honest line, the daemon code',
    async (_name, status, body, code, message) => {
      served = await serve(() => [status, body]);
      const err = await hostClient(served.port)
        .add({ id: 'probe' })
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code, message, status });
      const details = (body as { error: { details?: object } }).error.details ?? {};
      expect((err as { details: object }).details).toEqual(details);
    }
  );

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
      message: `the daemon on 127.0.0.1:${port} did not answer in 0.2 s; the daemon may still finish the install: agentage daemon status shows it under pending, then agentage extension list shows if it was installed`,
    });
    await expect(host.change('probe', { enabled: false })).rejects.toMatchObject({
      message: expect.stringMatching(
        /; the daemon may still finish the change: agentage daemon status shows it under pending, then agentage extension list shows the version$/
      ),
    });
    silent.closeAllConnections();
    await new Promise((done) => silent.close(done));
  });
});
