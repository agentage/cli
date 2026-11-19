/**
 * @offline - the core is closed (AGENTAGE_CORE_URL on a port nothing listens on): status, doctor
 * and the lists exit 0, the market list says market not reachable; an install that needs the
 * market fails (exit 1) and changes nothing.
 */
import { createServer } from 'node:net';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, type CliMachine } from './helpers.js';
import { startStubSite, stubEnv, type StubSite } from './stub/auth-server.js';

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

let stub: StubSite;
let machine: CliMachine;

test.beforeAll(async () => {
  assertCliBuilt();
  stub = await startStubSite();
  machine = createCliMachine({
    ...stubEnv(stub),
    AGENTAGE_CORE_URL: `http://127.0.0.1:${await freePort()}`,
    AGENTAGE_NO_DAEMON: undefined,
    AGENTAGE_DAEMON_PORT: String(await freePort()),
  });
});

test.afterAll(async () => {
  await machine.exec(['daemon', 'stop']);
  machine.cleanup();
  await stub.close();
});

test('status and extension doctor exit 0 with the core closed @offline', async () => {
  for (const args of [['status'], ['extension', 'doctor']]) {
    const result = await machine.exec(args, 30_000);
    expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0);
  }
});

test('extension list --available: an empty list, one line market not reachable, exit 0 @offline', async () => {
  const result = await machine.exec(['extension', 'list', '--available'], 30_000);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim().split('\n')).toEqual([
    expect.stringMatching(/^market not reachable: /),
  ]);
  const json = await machine.exec(['extension', 'list', '--available', '--json'], 30_000);
  expect(json.code, json.stderr).toBe(0);
  expect(JSON.parse(json.stdout)).toMatchObject({
    data: [],
    meta: { down: { code: 'market_unreachable' } },
  });
});

test('install probe needs the market: market not reachable, exit 1, the list is the same @offline', async () => {
  const before = await machine.exec(['extension', 'list'], 60_000);
  expect(before.code, before.stderr).toBe(0);
  const install = await machine.exec(['extension', 'install', 'probe'], 60_000);
  expect(install.code).toBe(1);
  expect(install.stderr).toContain('market not reachable');
  const after = await machine.exec(['extension', 'list'], 30_000);
  expect(after.code, after.stderr).toBe(0);
  expect(after.stdout).toBe(before.stdout);
});
