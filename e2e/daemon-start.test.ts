/**
 * @offline - `daemon start --json` (C5): connect-or-start on a free loopback port, started by the
 * desktop when AGENTAGE_STARTED_BY=desktop; a second start connects to the same pid.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, type CliMachine } from './helpers.js';

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

let machine: CliMachine;
let port: number;

test.beforeAll(async () => {
  assertCliBuilt();
  port = await freePort();
  machine = createCliMachine({
    AGENTAGE_NO_DAEMON: undefined,
    AGENTAGE_DAEMON_PORT: String(port),
    AGENTAGE_STARTED_BY: 'desktop',
  });
});

test.afterAll(async () => {
  await machine.exec(['daemon', 'stop']);
  machine.cleanup();
});

test('daemon start --json starts the daemon as the desktop, then connects to it @offline', async () => {
  const first = await machine.exec(['daemon', 'start', '--json'], 60_000);
  expect(first.code, first.stderr).toBe(0);
  const { data } = JSON.parse(first.stdout) as { data: Record<string, unknown> };
  expect(data).toEqual({
    pid: expect.any(Number),
    url: `http://127.0.0.1:${port}`,
    protocol: 1,
    startedBy: 'desktop',
  });
  const file = JSON.parse(readFileSync(join(machine.configDir, 'daemon.json'), 'utf8')) as object;
  expect(file).toMatchObject({ pid: data['pid'], port, startedBy: 'desktop' });
  expect(first.stdout).not.toContain('hostToken');
  const again = await machine.exec(['daemon', 'start', '--json']);
  expect(again.code, again.stderr).toBe(0);
  expect((JSON.parse(again.stdout) as { data: unknown }).data).toEqual(data);
});
