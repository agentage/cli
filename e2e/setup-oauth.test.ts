/**
 * @p0 - the full headless sign-in round trip against the live deployed stack:
 * `agentage setup --no-browser` mints a DCR client and waits on its localhost
 * callback; the test plays "the browser" with a signed-in session, then
 * asserts status, idempotent re-run, and disconnect.
 *
 * Env: AGENTAGE_SITE_FQDN (default dev); E2E_AUTH_EMAIL / E2E_AUTH_PASSWORD
 * reuse a stable account when set, else a throwaway account is signed up.
 */
import { expect, test } from '@playwright/test';
import {
  assertCliBuilt,
  createCliMachine,
  ensureSession,
  newBrowserContext,
  statusJson,
  testAccount,
  waitForAuthorizeUrl,
} from './helpers.js';

test('setup signs in, status confirms, disconnect cleans up @p0', async () => {
  assertCliBuilt();
  const machine = createCliMachine();
  const browser = await newBrowserContext();
  try {
    await ensureSession(browser, testAccount());

    // CLI side: start the flow and capture its authorize URL.
    const setup = machine.startSetup();
    const authorizeUrl = await waitForAuthorizeUrl(setup);

    // Browser side: the session cookie turns authorize into a 302 to the
    // CLI's localhost callback; following it hands the code to the CLI.
    const authorize = await browser.get(authorizeUrl, { maxRedirects: 0 });
    expect(authorize.status(), 'authorize should 302 for a signed-in session').toBe(302);
    const location = authorize.headers()['location'] ?? '';
    expect(location).toContain('http://localhost:');
    const callback = await browser.get(location);
    expect(callback.ok(), `callback failed: ${callback.status()}`).toBe(true);

    const exitCode = await setup.waitExit();
    expect(exitCode, setup.output()).toBe(0);
    expect(setup.output()).toContain('Signed in.');

    const signedIn = await statusJson(machine);
    expect(signedIn.auth.signedIn).toBe(true);
    expect(signedIn.endpoint.reachable).toBe(true);

    // Idempotent: a second setup must not start a new flow.
    const again = await machine.exec(['setup', '--no-browser']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain('Already signed in');

    const disconnect = await machine.exec(['setup', '--disconnect']);
    expect(disconnect.code, disconnect.stderr).toBe(0);
    expect(disconnect.stdout).toContain('Disconnected');

    const signedOut = await statusJson(machine);
    expect(signedOut.auth.signedIn).toBe(false);
    expect(signedOut.auth.note).toContain('agentage setup');
  } finally {
    await browser.dispose();
    machine.cleanup();
  }
});
