import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CallbackServer } from '../lib/callback-server.js';
import { readAuth, saveAuth, type AuthState } from '../lib/config.js';
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

  it('short-circuits when already signed in', async () => {
    saveAuth(existingAuth);
    const { deps } = makeDeps();
    await runSetup({}, deps);
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.printStatus).toHaveBeenCalled();
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
