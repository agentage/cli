import { afterEach, describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';

const jwtPat = (iss: string) =>
  `aga_h.${Buffer.from(JSON.stringify({ iss, exp: 4e9 })).toString('base64url')}.s`;

// Every request, and those that carry a bearer; the site names its issuer, or serves no document.
const stubFetch = (issuer?: string) => {
  const all: string[] = [];
  const bearer: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    all.push(url);
    if (new Headers(init?.headers).get('authorization')) bearer.push(url);
    if (!url.endsWith('/.well-known/agentage.json')) return Response.json({ userId: 'user_1' });
    if (!issuer) return new Response('', { status: 404 });
    return Response.json({ platform: new URL(url).origin, issuer });
  });
  return { all, bearer };
};

// The cli captures fetch at load, so the module loads after the stub.
const account = async (iss: string) => {
  vi.resetModules();
  const { signedInAccount } = await import('./account.js');
  return signedInAccount({ token: jwtPat(iss) });
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['AGENTAGE_SITE_FQDN'];
});

describe('an env JWT PAT and the issuer in its own iss claim', () => {
  test('a foreign iss with no discovery document: no account, no request carries the token', async () => {
    process.env['AGENTAGE_SITE_FQDN'] = 'pat-a.agentage.io';
    const sent = stubFetch();
    expect(await account('https://evil.example/x')).toBeNull();
    expect(sent.bearer).toEqual([]);
    expect(sent.all.every((u) => !u.startsWith('https://evil.example'))).toBe(true);
  });

  test("an iss that is not the site's declared issuer: no account, no request carries the token", async () => {
    process.env['AGENTAGE_SITE_FQDN'] = 'pat-b.agentage.io';
    const sent = stubFetch('https://auth.agentage.io');
    expect(await account('https://evil.example/x')).toBeNull();
    expect(sent.bearer).toEqual([]);
    expect(sent.all.every((u) => !u.startsWith('https://evil.example'))).toBe(true);
  });

  test("an iss equal to the site's declared issuer reaches only that issuer", async () => {
    process.env['AGENTAGE_SITE_FQDN'] = 'pat-c.agentage.io';
    const sent = stubFetch('https://auth.agentage.io');
    const signedIn = await account('https://auth.agentage.io');
    expect(await signedIn?.id()).toBe('user_1');
    expect(sent.bearer.map((u) => new URL(u).origin)).toEqual(['https://auth.agentage.io']);
  });
});
