import { describe, expect, it, vi } from 'vitest';
import { type AuthState } from '../fs/config.js';
import { links } from '../net/origins.js';
import { provisionAccountVault, type ProvisionDeps } from './provision.js';

const target = links('dev.agentage.io');

const auth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'tok', refreshToken: 'rt' },
};

const jsonResponse = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeDeps = (
  over: Partial<ProvisionDeps> = {}
): { deps: ProvisionDeps; post: ReturnType<typeof vi.fn> } => {
  const post = vi.fn(async () => jsonResponse(201));
  const deps: ProvisionDeps = {
    readAuth: () => auth,
    links: () => target,
    post,
    ...over,
  };
  return { deps, post };
};

describe('provisionAccountVault', () => {
  it('POSTs {name, channel:"couch"} to <api>/memories when signed in', async () => {
    const { deps, post } = makeDeps();
    await provisionAccountVault('acct', deps);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(auth, target, `${target.api}/memories`, {
      name: 'acct',
      channel: 'couch',
    });
  });

  it('201 -> provisioned', async () => {
    const { deps } = makeDeps({ post: vi.fn(async () => jsonResponse(201)) });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('provisioned');
    expect(res.message).toContain("Provisioned account vault 'acct'");
  });

  it('200 -> exists (idempotent, already on the channel)', async () => {
    const { deps } = makeDeps({ post: vi.fn(async () => jsonResponse(200)) });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('exists');
    expect(res.message).toContain('already provisioned');
  });

  it('403 CHANNEL_DISABLED -> disabled, kept locally', async () => {
    const post = vi.fn(async () => jsonResponse(403, { error: { code: 'CHANNEL_DISABLED' } }));
    const { deps } = makeDeps({ post });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('disabled');
    expect(res.message).toContain('registered locally');
    expect(res.message).toContain('not enabled');
  });

  it('409 CHANNEL_CONFLICT -> conflict, kept locally, no retry on another channel', async () => {
    const post = vi.fn(async () => jsonResponse(409, { error: { code: 'CHANNEL_CONFLICT' } }));
    const { deps } = makeDeps({ post });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('conflict');
    expect(res.message).toContain('another channel');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('accepts a top-level error code envelope too', async () => {
    const post = vi.fn(async () => jsonResponse(403, { code: 'CHANNEL_DISABLED' }));
    const { deps } = makeDeps({ post });
    expect((await provisionAccountVault('acct', deps)).status).toBe('disabled');
  });

  it('401 -> unauthenticated, kept locally with a setup hint', async () => {
    const { deps } = makeDeps({ post: vi.fn(async () => jsonResponse(401)) });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('unauthenticated');
    expect(res.message).toContain('agentage setup');
  });

  it('no auth.json -> unauthenticated without any network call', async () => {
    const post = vi.fn(async () => jsonResponse(201));
    const { deps } = makeDeps({ readAuth: () => null, post });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('unauthenticated');
    expect(res.message).toContain('agentage setup');
    expect(post).not.toHaveBeenCalled();
  });

  it('PAT credential -> unauthenticated without any network call (MCP-only, no REST provision)', async () => {
    const post = vi.fn(async () => jsonResponse(201));
    const patAuth: AuthState = { ...auth, kind: 'pat', tokens: { accessToken: 'aga_x' } };
    const { deps } = makeDeps({ readAuth: () => patAuth, post });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('unauthenticated');
    expect(res.message).toContain('personal access token only authorizes memory');
    expect(post).not.toHaveBeenCalled();
  });

  it('network failure -> offline, kept locally, will provision when online', async () => {
    const post = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { deps } = makeDeps({ post });
    const res = await provisionAccountVault('acct', deps);
    expect(res.status).toBe('offline');
    expect(res.message).toContain('when online');
  });

  it('an unexpected status stays non-fatal (offline)', async () => {
    const { deps } = makeDeps({ post: vi.fn(async () => jsonResponse(500)) });
    expect((await provisionAccountVault('acct', deps)).status).toBe('offline');
  });
});
