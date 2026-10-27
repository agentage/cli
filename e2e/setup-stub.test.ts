/**
 * @p0 @offline - the full `agentage setup --no-browser` round trip against the
 * loopback stub (e2e/stub/): DCR, PKCE authorize, code exchange, get-session,
 * refresh rotation and revoke. The test plays "the browser" with a manual-redirect
 * fetch; no live stack, no secrets, so it runs on every PR.
 */
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  assertCliBuilt,
  authUrlFor,
  createCliMachine,
  statusJson,
  type CliMachine,
} from './helpers.js';
import { startStubSite, stubEnv, type StubSite } from './stub/auth-server.js';
import {
  authPath,
  fileMode,
  readAuthFile,
  refreshAt,
  sessionAt,
  signInVia,
  sleepUntil,
} from './stub/client.js';

const TOKEN = '/api/auth/mcp/token';
const GET_SESSION = '/api/auth/mcp/get-session';

let stub: StubSite;

const withMachine = async (fn: (machine: CliMachine) => Promise<void>): Promise<void> => {
  const machine = createCliMachine(stubEnv(stub));
  try {
    await fn(machine);
  } finally {
    machine.cleanup();
  }
};

const statusesSince = (mark: number, path: string, grantType?: string): number[] =>
  stub.state.requests
    .slice(mark)
    .filter((r) => r.path === path && (!grantType || r.grantType === grantType))
    .map((r) => r.status);

const expectStubTokensStored = (machine: CliMachine): void => {
  expect(fileMode(authPath(machine))).toBe(0o600);
  const auth = readAuthFile(machine);
  const issued = stub.state.tokens.at(-1);
  expect(auth.siteFqdn).toBe(stub.fqdn);
  expect(auth.clientId).toBe(issued?.clientId);
  expect(auth.tokens.accessToken).toBe(issued?.accessToken);
  expect(auth.tokens.refreshToken).toBe(issued?.refreshToken);
  expect(stub.state.codes.at(-1)?.used).toBe(true);
};

test.describe('hermetic sign-in round trip @p0 @offline', () => {
  test.beforeAll(async () => {
    assertCliBuilt();
    stub = await startStubSite();
  });

  test.afterAll(() => stub.close());

  test.beforeEach(() => {
    Object.assign(stub.state, { expiresIn: 3600, transientGetSession: 0, denyAuthorize: false });
  });

  test('setup signs in, stores the stub tokens 0600, status confirms, re-run is a no-op', () =>
    withMachine(async (machine) => {
      const run = await signInVia(machine);
      expect(run.url.startsWith(`${authUrlFor(stub.fqdn)}/api/auth/mcp/authorize?`)).toBe(true);
      expect(run.location.origin).toMatch(/^http:\/\/localhost:\d+$/);
      expect(run.code, run.output).toBe(0);
      expect(run.output).toContain('Signed in.');
      expectStubTokensStored(machine);
      const report = await statusJson(machine);
      expect(report.auth.signedIn).toBe(true);
      expect(report.endpoint.reachable).toBe(true);
      const again = await machine.exec(['setup', '--no-browser']);
      expect(again.code, again.stderr).toBe(0);
      expect(again.stdout).toContain('Already signed in');
    }));

  test('setup --disconnect revokes at the stub and removes auth.json', () =>
    withMachine(async (machine) => {
      expect((await signInVia(machine)).code).toBe(0);
      const { clientId, tokens } = readAuthFile(machine);
      const disconnect = await machine.exec(['setup', '--disconnect']);
      expect(disconnect.code, disconnect.stderr).toBe(0);
      expect(disconnect.stdout).toContain('Disconnected');
      expect(existsSync(authPath(machine))).toBe(false);
      expect(stub.state.revocations).toContain(tokens.accessToken);
      expect(await sessionAt(stub, tokens.accessToken)).toBeNull();
      expect((await refreshAt(stub, clientId, tokens.refreshToken ?? '')).status).toBe(400);
      const report = await statusJson(machine);
      expect(report.auth.signedIn).toBe(false);
      expect(report.auth.note).toContain('agentage setup');
    }));

  test('a denied authorize fails setup with exit 1 and writes no auth.json', () =>
    withMachine(async (machine) => {
      stub.state.denyAuthorize = true;
      const mark = stub.state.requests.length;
      const run = await signInVia(machine);
      expect(run.location.searchParams.get('error')).toBe('access_denied');
      expect(run.code, run.output).toBe(1);
      expect(run.stderr).toContain('authorization failed: access_denied');
      expect(existsSync(authPath(machine))).toBe(false);
      expect(statusesSince(mark, TOKEN)).toEqual([]);
    }));

  test('status refreshes an expired access token and stores the rotated refresh token', () =>
    withMachine(async (machine) => {
      stub.state.expiresIn = 1;
      expect((await signInVia(machine)).code).toBe(0);
      stub.state.expiresIn = 3600;
      const before = readAuthFile(machine);
      await sleepUntil((before.tokens.expiresAt ?? 0) + 50);
      const mark = stub.state.requests.length;
      expect((await statusJson(machine)).auth.signedIn).toBe(true);
      expect(statusesSince(mark, TOKEN, 'refresh_token')).toEqual([200]);
      const after = readAuthFile(machine);
      expect(after.tokens.refreshToken).not.toBe(before.tokens.refreshToken);
      expect(after.tokens.refreshToken).toBe(stub.state.tokens.at(-1)?.refreshToken);
      const replay = await refreshAt(stub, before.clientId, before.tokens.refreshToken ?? '');
      expect(replay).toEqual({ status: 400, body: { error: 'invalid_grant' } });
    }));

  test('a transient get-session 503 is retried and status still exits 0', () =>
    withMachine(async (machine) => {
      // No stored expiry to hold on to, so the 503 must take the backoff-and-retry path.
      stub.state.expiresIn = 0;
      expect((await signInVia(machine)).code).toBe(0);
      stub.state.transientGetSession = 1;
      const mark = stub.state.requests.length;
      const report = await statusJson(machine);
      expect(report.auth.signedIn).toBe(true);
      expect(report.auth.transient).toBeUndefined();
      expect(statusesSince(mark, GET_SESSION)).toEqual([503, 200]);
    }));
});
