/**
 * @offline - `auth token` (desktop gap G6) against the loopback stub: a token near its end is
 * refreshed first, a fresh one is printed as is, signed out (or a PAT only) exits 1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, type CliMachine } from './helpers.js';
import { startStubSite, stubEnv, type StubSite } from './stub/auth-server.js';
import { issueToken } from './stub/state.js';

let stub: StubSite;
let machine: CliMachine;

const signIn = (expiresInMs: number): string => {
  const t = issueToken(stub.state, 'cli-e2e', 'openid');
  const tokens = {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: Date.now() + expiresInMs,
  };
  const auth = { siteFqdn: stub.fqdn, issuer: stub.url, clientId: 'cli-e2e', tokens };
  writeFileSync(join(machine.configDir, 'auth.json'), JSON.stringify(auth));
  return t.accessToken;
};

const stored = (): string =>
  (
    JSON.parse(readFileSync(join(machine.configDir, 'auth.json'), 'utf8')) as {
      tokens: { accessToken: string };
    }
  ).tokens.accessToken;

test.beforeAll(async () => {
  assertCliBuilt();
  stub = await startStubSite();
  machine = createCliMachine(stubEnv(stub));
});

test.afterAll(async () => {
  machine.cleanup();
  await stub.close();
});

test('auth token prints a token that lives over 60 s as is, on stdout alone @offline', async () => {
  const token = signIn(3_600_000);
  const result = await machine.exec(['auth', 'token']);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toBe(`${token}\n`);
});

test('auth token --json refreshes a token that ends within 60 s first @offline', async () => {
  const old = signIn(30_000);
  const result = await machine.exec(['auth', 'token', '--json']);
  expect(result.code, result.stderr).toBe(0);
  const { data } = JSON.parse(result.stdout) as {
    data: { accessToken: string; expiresAt: string };
  };
  expect(data.accessToken).not.toBe(old);
  expect(data.accessToken).toBe(stored());
  expect(Date.parse(data.expiresAt)).toBeGreaterThan(Date.now() + 60_000);
});

test('signed out, auth token exits 1 with auth_required and never prints AGENTAGE_TOKEN @offline', async () => {
  writeFileSync(join(machine.configDir, 'auth.json'), '{}');
  const pat = 'agt_pat_e2e_never_printed';
  const result = await machine.exec(['auth', 'token', '--json'], 30_000, { AGENTAGE_TOKEN: pat });
  expect(result.code).toBe(1);
  expect((JSON.parse(result.stdout) as { error: { code: string } }).error.code).toBe(
    'auth_required'
  );
  expect(result.stdout + result.stderr).not.toContain(pat);
});
