import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { test } from '../../test/config-dir.js';
import { serve, type Served } from '../../test/serve.js';
import { hostClient, sameDaemon } from './host-client.js';

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const fail = (code: string, message: string, details?: object) => ({
  success: false,
  error: { code, message, ...(details && { details }) },
});

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
    await expect(host.list()).rejects.toMatchObject({
      code: 'daemon_unavailable',
      message: expect.stringMatching(
        /answered HTTP 500 with no agentage answer; agentage daemon status/
      ),
    });
  });

  it('a 200 that is no envelope (another program) is daemon_unavailable, never success', async () => {
    served = await serve(() => [200, { hello: 'world' }]);
    await expect(hostClient(served.port).reload('demo')).rejects.toMatchObject({
      code: 'daemon_unavailable',
      message: `127.0.0.1:${served.port} answered HTTP 200 with no agentage answer; agentage daemon status shows what runs there, agentage daemon restart starts it again`,
    });
  });

  const STATUS = 'agentage daemon status';
  const ANSWERS: [string, number, object, string, string][] = [
    [
      '409 installed: the details pass',
      409,
      fail('CONFLICT', 'probe is installed', { id: 'probe', version: '0.6.2' }),
      'CONFLICT',
      'probe is installed',
    ],
    [
      '409 the installer still runs',
      409,
      fail('CONFLICT', 'the installer of probe still runs', {
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
      fail(
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
      fail('DAEMON_RUNNING', 'a daemon (process 7) runs on /c: change it through it'),
      'DAEMON_RUNNING',
      'a daemon (process 7) runs on /c: change it through it',
    ],
    [
      '503 a locked file',
      503,
      fail('UNAVAILABLE', 'settings.json is locked by process 7: waited 5000 ms'),
      'UNAVAILABLE',
      'settings.json is locked by process 7: waited 5000 ms; try again',
    ],
    [
      '503 the daemon stops',
      503,
      fail('UNAVAILABLE', 'the daemon stops'),
      'UNAVAILABLE',
      'the daemon stops; try again',
    ],
    [
      '503 a queue that waited: no second try again',
      503,
      fail('UNAVAILABLE', 'other changes ran for 5 ms: try again'),
      'UNAVAILABLE',
      'other changes ran for 5 ms: try again',
    ],
    [
      '504 the installer timed out',
      504,
      fail('TIMEOUT', 'the installer did not answer in 600000 ms'),
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
    const reload = hostClient(port, { read: 100, change: 60_000, reload: 150 }).reload('demo');
    await expect(reload).rejects.toMatchObject({
      code: 'timeout',
      message: `the daemon on 127.0.0.1:${port} did not answer in 0.15 s; agentage extension list shows its state; agentage daemon restart if it stays so`,
    });
    silent.closeAllConnections();
    await new Promise((done) => silent.close(done));
  });
});

describe('the host token on /host/* (D11)', () => {
  const WAITS = { read: 2_000, change: 2_000 };

  it('sends the token of daemon.json as a bearer, and POSTs {} to reload', async () => {
    const auth: (string | undefined)[] = [];
    served = await serve((req) => {
      auth.push(req.headers.authorization);
      return [200, { success: true, data: { id: 'demo', reloaded: true } }];
    });
    const host = hostClient(served.port, WAITS, () => 'tok');
    expect(await host.reload('demo')).toEqual({ id: 'demo', reloaded: true });
    expect(served.seen[0]).toMatchObject({ method: 'POST', url: '/host/extensions/demo/reload' });
    expect(served.seen[0]?.body).toEqual({});
    expect(auth).toEqual(['Bearer tok']);
  });

  it('POSTs exactly { part: "app" } for an app reload (S1.2.3)', async () => {
    served = await serve(() => [200, { success: true, data: { id: 'demo', reloaded: true } }]);
    await hostClient(served.port, WAITS, () => 'tok').reload('demo', 'app');
    expect(served.seen[0]?.body).toEqual({ part: 'app' });
  });

  it('a 401 or 403 reads daemon.json again and retries once: a new daemon answers', async () => {
    served = await serve((req) =>
      req.headers.authorization === 'Bearer new'
        ? [200, { success: true, data: [] }]
        : [401, fail('UNAUTHORIZED', 'host token required')]
    );
    const tokens = ['old', 'new'];
    const host = hostClient(
      served.port,
      WAITS,
      () => tokens.shift(),
      async () => true
    );
    expect(await host.list()).toEqual([]);
    expect(served.seen).toHaveLength(2);
  });

  it('a refusal that stays says what to do, keeps the code, asks no third time', async () => {
    served = await serve(() => [403, fail('FORBIDDEN', 'The host token is not valid')]);
    const host = hostClient(
      served.port,
      WAITS,
      () => 'stale',
      async () => true
    );
    await expect(host.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringMatching(
        /^the daemon refused the host token of .*daemon\.json \(The host token is not valid\); run agentage daemon restart$/
      ),
    });
    expect(served.seen).toHaveLength(2);
  });

  it('no token in daemon.json sends no authorization header', async () => {
    const auth: (string | undefined)[] = [];
    served = await serve(
      (req) => (auth.push(req.headers.authorization), [200, { success: true, data: [] }])
    );
    await hostClient(served.port, WAITS, () => undefined).list();
    expect(auth).toEqual([undefined]);
  });

  test('no retry when daemon.json names another port or its pid does not answer there', async ({
    dir,
  }) => {
    served = await serve(() => [401, fail('UNAUTHORIZED', 'host token required')]);
    const host = hostClient(served.port, WAITS, () => 'old');
    dir.write('daemon.json', { pid: process.pid, port: served.port + 1, hostToken: 'new' });
    await expect(host.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(served.seen).toHaveLength(1);
    dir.write('daemon.json', { pid: process.pid, port: served.port, hostToken: 'new' });
    expect(await sameDaemon(served.port)).toBe(false);
  });

  it('a redirect from the port is refused, never followed with the token', async () => {
    const asked: string[] = [];
    const server = createServer((req, res) => {
      asked.push(req.url ?? '');
      res.writeHead(302, { location: '/elsewhere' }).end();
    }).listen(0, '127.0.0.1');
    await new Promise((done) => server.once('listening', done));
    const { port } = server.address() as AddressInfo;
    await expect(hostClient(port, WAITS, () => 'tok').list()).rejects.toMatchObject({
      code: 'daemon_unavailable',
    });
    await new Promise((done) => server.close(done));
    expect(asked).toEqual(['/host/extensions']);
  });
});
