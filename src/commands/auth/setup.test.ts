import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CallbackServer } from '../../lib/auth/callback-server.js';
import { AuthRequiredError, TransientAuthError } from '../../lib/auth/api.js';
import { readAuth, saveAuth, type AuthState } from '../../lib/fs/config.js';
import { runSetup, type SetupDeps } from './setup.js';

const existingAuth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'old-client',
  tokens: { accessToken: 'old-at' },
};

const makeDeps = () => {
  const close = vi.fn();
  const server: CallbackServer = {
    redirectUri: 'http://localhost:4242/callback',
    waitForCode: vi.fn().mockResolvedValue('code-1'),
    close,
  };
  const deps: SetupDeps = {
    register: vi.fn().mockResolvedValue('client-1'),
    exchange: vi
      .fn()
      .mockResolvedValue({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
    revoke: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(server),
    openBrowser: vi.fn().mockResolvedValue(undefined),
    printStatus: vi.fn().mockResolvedValue(undefined),
    ensureDaemon: vi.fn().mockResolvedValue({}),
    introspect: vi.fn().mockResolvedValue({ userId: 'u1' }),
  };
  return { deps, server, close };
};

describe('runSetup', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-setup-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
    process.env['AGENTAGE_SITE_FQDN'] = 'dev.agentage.io';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    delete process.env['AGENTAGE_SITE_FQDN'];
    delete process.env['AGENTAGE_NO_DAEMON'];
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs the full sign-in flow and persists auth state', async () => {
    const { deps, close } = makeDeps();
    await runSetup({}, deps);
    expect(deps.register).toHaveBeenCalledWith(
      'https://auth.dev.agentage.io',
      'http://localhost:4242/callback'
    );
    expect(deps.openBrowser).toHaveBeenCalledOnce();
    const auth = readAuth();
    expect(auth?.clientId).toBe('client-1');
    expect(auth?.tokens.accessToken).toBe('at-1');
    expect(auth?.tokens.refreshToken).toBe('rt-1');
    expect(auth?.siteFqdn).toBe('dev.agentage.io');
    expect(close).toHaveBeenCalled();
    expect(deps.printStatus).toHaveBeenCalled();
  });

  it('starts the daemon once on the successful sign-in path', async () => {
    const { deps } = makeDeps();
    await runSetup({}, deps);
    expect(deps.ensureDaemon).toHaveBeenCalledOnce();
  });

  it('does not start the daemon on --disconnect', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    await runSetup({ disconnect: true }, deps);
    expect(deps.ensureDaemon).not.toHaveBeenCalled();
  });

  it('does not start the daemon when AGENTAGE_NO_DAEMON is set', async () => {
    process.env['AGENTAGE_NO_DAEMON'] = '1';
    const { deps } = makeDeps();
    await runSetup({}, deps);
    expect(deps.ensureDaemon).not.toHaveBeenCalled();
    expect(readAuth()?.tokens.accessToken).toBe('at-1');
  });

  it('passes the authorize url with the registered client to the browser', async () => {
    const { deps } = makeDeps();
    await runSetup({}, deps);
    const url = new URL((deps.openBrowser as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('skips the browser with --no-browser', async () => {
    const { deps } = makeDeps();
    await runSetup({ browser: false }, deps);
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(readAuth()?.tokens.accessToken).toBe('at-1');
  });

  it('short-circuits when already signed in and the session validates', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    await runSetup({}, deps);
    expect(deps.introspect).toHaveBeenCalledOnce();
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.printStatus).toHaveBeenCalled();
    expect(readAuth()?.tokens.accessToken).toBe('old-at'); // creds untouched
  });

  it('signs into the current target when the stored credential is for a different env', async () => {
    // Credential is for dev; this run targets production - do not introspect cross-env, sign in fresh.
    saveAuth(existingAuth);
    process.env['AGENTAGE_SITE_FQDN'] = 'agentage.io';
    const { deps } = makeDeps();
    await runSetup({}, deps);
    expect(deps.introspect).not.toHaveBeenCalled();
    expect(deps.register).toHaveBeenCalled();
    expect(readAuth()?.siteFqdn).toBe('agentage.io');
    expect(readAuth()?.clientId).toBe('client-1');
  });

  it('signs into dev when a production credential meets a dev target', async () => {
    saveAuth({ ...existingAuth, siteFqdn: 'agentage.io' });
    process.env['AGENTAGE_SITE_FQDN'] = 'dev.agentage.io';
    const { deps } = makeDeps();
    await runSetup({}, deps);
    expect(deps.introspect).not.toHaveBeenCalled();
    expect(deps.register).toHaveBeenCalled();
    expect(readAuth()?.siteFqdn).toBe('dev.agentage.io');
  });

  it('auto-enters sign-in when the stored session is terminally expired', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    (deps.introspect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthRequiredError('session expired')
    );
    await runSetup({}, deps);
    // No --reauth flag needed: a dead session falls straight through to a fresh sign-in.
    expect(deps.register).toHaveBeenCalled();
    expect(readAuth()?.clientId).toBe('client-1');
  });

  it('does not force reauth or wipe creds on a transient verify failure', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    (deps.introspect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TransientAuthError('temporarily failed')
    );
    await runSetup({}, deps);
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.printStatus).toHaveBeenCalled();
    expect(readAuth()?.tokens.accessToken).toBe('old-at'); // creds intact
  });

  it('re-authenticates with --reauth despite existing auth', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    await runSetup({ reauth: true }, deps);
    expect(deps.register).toHaveBeenCalled();
    expect(readAuth()?.clientId).toBe('client-1');
  });

  it('disconnect revokes the token and removes credentials', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    await runSetup({ disconnect: true }, deps);
    expect(deps.revoke).toHaveBeenCalledWith('https://auth.dev.agentage.io', 'old-at');
    expect(readAuth()).toBeNull();
  });

  it('disconnect without credentials is a no-op', async () => {
    const { deps } = makeDeps();
    await runSetup({ disconnect: true }, deps);
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it('closes the callback server when the exchange fails', async () => {
    const { deps, close } = makeDeps();
    (deps.exchange as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await expect(runSetup({}, deps)).rejects.toThrow('boom');
    expect(close).toHaveBeenCalled();
    expect(readAuth()).toBeNull();
  });
});
