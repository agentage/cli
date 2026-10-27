/**
 * @offline - the built CLI against a single-origin loopback stub
 * (AGENTAGE_SITE_FQDN=127.0.0.1:<port>, plain http): status reachability,
 * a malformed auth.json, and the exit-code contract (0 / 1 / 2).
 */
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, type CliMachine } from './helpers.js';

let stub: Server;
let machine: CliMachine;

test.beforeAll(async () => {
  assertCliBuilt();
  stub = createServer((req, res) => {
    const health = req.url === '/api/health';
    res.writeHead(health ? 200 : 404, { 'content-type': 'application/json' });
    res.end(health ? '{"status":"ok"}' : '{}');
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const fqdn = `127.0.0.1:${(stub.address() as AddressInfo).port}`;
  machine = createCliMachine({ AGENTAGE_SITE_FQDN: fqdn });
});

test.afterAll(() => {
  machine.cleanup();
  stub.closeAllConnections();
  stub.close();
});

test('status reaches an http loopback target instead of failing on the protocol @offline', async () => {
  const result = await machine.exec(['status', '--json']);
  expect(result.code, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout) as {
    target: { reachable: boolean };
    endpoint: { reachable: boolean };
  };
  expect(report.target.reachable).toBe(true);
  expect(report.endpoint.reachable).toBe(true);
});

test('a malformed auth.json reads as signed out, never a silent exit 13 @offline', async () => {
  writeFileSync(join(machine.configDir, 'auth.json'), '{}');
  const status = await machine.exec(['status']);
  expect(status.code, status.stderr).toBe(0);
  expect(status.stdout).toContain('not signed in - run: agentage setup');
  const disconnect = await machine.exec(['setup', '--disconnect']);
  expect(disconnect.code, disconnect.stderr).toBe(0);
  expect(disconnect.stdout).toContain('Nothing to disconnect.');
});

test('a failed step exits 1 with the reason on stderr only @offline', async () => {
  const result = await machine.exec(['status', '--token', 'not-a-pat']);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('token must be a personal access token');
  expect(result.stdout).toBe('');
});

test('a usage error exits 2 @offline', async () => {
  const unknown = await machine.exec(['nope']);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toContain("unknown command 'nope'");
  const flag = await machine.exec(['status', '--nope']);
  expect(flag.code).toBe(2);
});
