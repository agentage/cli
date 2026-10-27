import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, TransientAuthError } from './auth-errors.js';
import { type CallbackServer } from './callback-server.js';
import { ensureSignedIn, signOut, type SignInDeps } from './sign-in.js';
import { readAuth, saveAuth, type AuthState } from '../fs/config.js';

const existingAuth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'old-client',
  tokens: { accessToken: 'old-at' },
};

const makeDeps = () => {
  const logs: string[] = [];
  const close = vi.fn();
  const server: CallbackServer = {
    redirectUri: 'http://localhost:4242/callback',
    waitForCode: vi.fn().mockResolvedValue('code-1'),
    close,
  };
  const deps: SignInDeps = {
    register: vi.fn().mockResolvedValue('client-1'),
    exchange: vi
      .fn()
      .mockResolvedValue({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
    revoke: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(server),
    openBrowser: vi.fn().mockResolvedValue(undefined),
    introspect: vi.fn().mockResolvedValue({ userId: 'u1' }),
    log: (msg) => logs.push(msg),
  };
  return { deps, close, logs };
};

describe('sign-in flow', () => {
  let dir: string;
  let level: typeof chalk.level;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-signin-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
    process.env['AGENTAGE_SITE_FQDN'] = 'dev.agentage.io';
    level = chalk.level;
    chalk.level = 0; // compare the exact user-facing text
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    delete process.env['AGENTAGE_SITE_FQDN'];
    rmSync(dir, { recursive: true, force: true });
    chalk.level = level;
  });

  it('runs the full sign-in flow and persists auth state', async () => {
    const { deps, close, logs } = makeDeps();
    expect(await ensureSignedIn({}, deps)).toBe('signed-in');
    expect(deps.register).toHaveBeenCalledWith(
      'https://auth.dev.agentage.io',
      'http://localhost:4242/callback'
    );
    expect(deps.openBrowser).toHaveBeenCalledOnce();
    expect(readAuth()).toMatchObject({
      siteFqdn: 'dev.agentage.io',
      clientId: 'client-1',
      tokens: { accessToken: 'at-1', refreshToken: 'rt-1' },
    });
    expect(readAuth()?.tokens.expiresAt).toBeGreaterThan(Date.now());
    expect(close).toHaveBeenCalled();
    expect(logs.at(0)).toMatch(/^\nSign in to agentage \(dev\.agentage\.io\):\n\n {2}https:\/\//);
    expect(logs.slice(1)).toEqual(['Waiting for sign-in to complete...', '\nSigned in.\n']);
  });

  it('passes the authorize url with the registered client to the browser', async () => {
    const { deps } = makeDeps();
    await ensureSignedIn({}, deps);
    const url = new URL(vi.mocked(deps.openBrowser).mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('skips the browser with --no-browser and says so', async () => {
    const { deps, logs } = makeDeps();
    await ensureSignedIn({ browser: false }, deps);
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(logs).toContain('Open the URL above in a browser to continue.');
    expect(readAuth()?.tokens.accessToken).toBe('at-1');
  });

  it('falls back to printing the URL when the browser cannot open', async () => {
    const { deps, logs } = makeDeps();
    vi.mocked(deps.openBrowser).mockRejectedValue(new Error('no display'));
    await ensureSignedIn({}, deps);
    expect(logs).toContain('Could not open a browser - use the URL above.');
  });

  it('short-circuits when already signed in and the session validates', async () => {
    saveAuth(existingAuth);
    const { deps, logs } = makeDeps();
    expect(await ensureSignedIn({}, deps)).toBe('already');
    expect(deps.introspect).toHaveBeenCalledOnce();
    expect(deps.register).not.toHaveBeenCalled();
    expect(logs).toEqual(['Already signed in. Run agentage setup --reauth to sign in again.\n']);
    expect(readAuth()?.tokens.accessToken).toBe('old-at'); // creds untouched
  });

  it('signs into the current target when the stored credential is for a different env', async () => {
    saveAuth(existingAuth);
    process.env['AGENTAGE_SITE_FQDN'] = 'agentage.io';
    const { deps, logs } = makeDeps();
    expect(await ensureSignedIn({}, deps)).toBe('mismatch-resigned');
    expect(deps.introspect).not.toHaveBeenCalled();
    expect(logs[0]).toBe(
      'Signed in to dev.agentage.io (development), but this run targets ' +
        'agentage.io (production) - signing you into production.\n'
    );
    expect(readAuth()?.siteFqdn).toBe('agentage.io');
    expect(readAuth()?.clientId).toBe('client-1');
  });

  it('signs into dev when a production credential meets a dev target', async () => {
    saveAuth({ ...existingAuth, siteFqdn: 'agentage.io' });
    const { deps } = makeDeps();
    expect(await ensureSignedIn({}, deps)).toBe('mismatch-resigned');
    expect(deps.introspect).not.toHaveBeenCalled();
    expect(readAuth()?.siteFqdn).toBe('dev.agentage.io');
  });

  it('auto-enters sign-in when the stored session is terminally expired', async () => {
    saveAuth(existingAuth);
    const { deps, logs } = makeDeps();
    vi.mocked(deps.introspect).mockRejectedValue(new AuthRequiredError('session expired'));
    expect(await ensureSignedIn({}, deps)).toBe('signed-in');
    expect(logs[0]).toBe('Session expired - signing you in again.\n');
    expect(readAuth()?.clientId).toBe('client-1');
  });

  it('does not force reauth or wipe creds on a transient verify failure', async () => {
    saveAuth(existingAuth);
    const { deps, logs } = makeDeps();
    vi.mocked(deps.introspect).mockRejectedValue(new TransientAuthError('temporarily failed'));
    expect(await ensureSignedIn({}, deps)).toBe('already');
    expect(deps.register).not.toHaveBeenCalled();
    expect(logs).toEqual(['You appear signed in (could not fully verify - temporary).\n']);
    expect(readAuth()?.tokens.accessToken).toBe('old-at'); // creds intact
  });

  it('re-authenticates with --reauth despite existing auth', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    expect(await ensureSignedIn({ reauth: true }, deps)).toBe('signed-in');
    expect(deps.introspect).not.toHaveBeenCalled();
    expect(readAuth()?.clientId).toBe('client-1');
  });

  it('treats a malformed auth.json as signed out and signs in fresh', async () => {
    writeFileSync(join(dir, 'auth.json'), '{}');
    const { deps } = makeDeps();
    expect(await ensureSignedIn({}, deps)).toBe('signed-in');
    expect(deps.introspect).not.toHaveBeenCalled();
  });

  it('closes the callback server when the exchange fails', async () => {
    const { deps, close } = makeDeps();
    vi.mocked(deps.exchange).mockRejectedValue(new Error('boom'));
    await expect(ensureSignedIn({}, deps)).rejects.toThrow('boom');
    expect(close).toHaveBeenCalled();
    expect(readAuth()).toBeNull();
  });

  describe('signOut', () => {
    it('revokes the token and removes credentials', async () => {
      saveAuth(existingAuth);
      const { deps, logs } = makeDeps();
      await signOut(deps);
      expect(deps.revoke).toHaveBeenCalledWith('https://auth.dev.agentage.io', 'old-at');
      expect(readAuth()).toBeNull();
      expect(logs).toEqual(['Disconnected - local credentials removed.']);
    });

    it('is a no-op without credentials, including a malformed auth.json', async () => {
      const { deps, logs } = makeDeps();
      await signOut(deps);
      writeFileSync(join(dir, 'auth.json'), '{}');
      await signOut(deps);
      expect(deps.revoke).not.toHaveBeenCalled();
      expect(logs).toEqual(['Nothing to disconnect.', 'Nothing to disconnect.']);
    });
  });
});
