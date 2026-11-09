import { describe, expect, it, vi } from 'vitest';
import { discoverTarget, issuerAllowed } from './discovery.js';

const discoverPlatform = async (fqdn: string, get: (url: string) => Promise<Response>) =>
  (await discoverTarget(fqdn, get)).platform;

const serving = (body: unknown, status = 200) => {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { get, urls };
};

describe('discoverPlatform', () => {
  it('reads /.well-known/agentage.json on the site and builds the machines base from its platform', async () => {
    const { get, urls } = serving({ platform: 'https://platform.next.agentage.io/' });
    expect(await discoverPlatform('next.agentage.io', get)).toEqual({
      url: 'https://platform.next.agentage.io',
      machines: 'https://platform.next.agentage.io/api/v1/machines',
    });
    expect(urls).toEqual(['https://next.agentage.io/.well-known/agentage.json']);
  });

  it.each([
    ['a 404', serving({}, 404).get],
    ['an unreachable site', () => Promise.reject(new TypeError('fetch failed'))],
  ])('keeps the api origin on %s', async (_name, get) => {
    expect(await discoverPlatform('agentage.io', get)).toEqual({
      url: 'https://api.agentage.io',
      machines: 'https://api.agentage.io/v1/machines',
    });
  });

  it('drops a path, query and hash from the platform', async () => {
    const { get } = serving({ platform: 'https://platform.agentage.io/x?y=1#z' });
    expect((await discoverPlatform('agentage.io', get)).url).toBe('https://platform.agentage.io');
  });

  it('says why on stderr under AGENTAGE_DEBUG=1 when a 5xx falls back', async () => {
    process.env['AGENTAGE_DEBUG'] = '1';
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await discoverPlatform('agentage.io', serving({}, 503).get);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('answered 503'));
    } finally {
      delete process.env['AGENTAGE_DEBUG'];
      err.mockRestore();
    }
  });

  it.each([
    ['no platform field', { issuer: 'x' }],
    ['a platform that is not a URL', { platform: 'nope' }],
    ['a foreign host', { platform: 'https://evil.example' }],
    ['a look-alike host', { platform: 'https://notagentage.io' }],
    ['http on an https site', { platform: 'http://platform.agentage.io' }],
    ['a file: URL', { platform: 'file:///etc/passwd' }],
  ])('refuses a served document with %s, naming it', async (_name, body) => {
    await expect(discoverPlatform('agentage.io', serving(body).get)).rejects.toThrow(
      'FAIL discovery: https://agentage.io/.well-known/agentage.json has no "platform"'
    );
  });
});

describe('the issuer', () => {
  // Rule: same scheme and port as the site, no userinfo, and the site host, a subdomain of it, or,
  // only when the site host has 3+ labels (so the parent has 2+) and is not an IP, a subdomain of its parent.
  it.each([
    ['https://auth.agentage.io', 'https://next.agentage.io', true],
    ['https://next.agentage.io', 'https://next.agentage.io', true],
    ['https://auth.next.agentage.io', 'https://next.agentage.io', true],
    ['https://agentage.io', 'https://next.agentage.io', false],
    ['https://evil.com', 'https://next.agentage.io', false],
    ['https://evil.io', 'https://agentage.io', false],
    ['https://auth.agentage.io.evil.com', 'https://next.agentage.io', false],
    ['http://auth.agentage.io', 'https://next.agentage.io', false],
    ['http://127.0.0.1:4000', 'http://127.0.0.1:4000', true],
    ['not a url', 'https://next.agentage.io', false],
    ['https://evilagentage.io', 'https://next.agentage.io', false],
    ['https://evilagentage.io', 'https://agentage.io', false],
    ['https://user:pw@auth.agentage.io', 'https://next.agentage.io', false],
    ['https://auth.agentage.io:8443', 'https://next.agentage.io', false],
    ['https://auth.agentage.co.uk', 'https://next.agentage.co.uk', true],
    // The limit of a rule without a public-suffix list: a 3-label apex trusts its suffix.
    ['https://evil.co.uk', 'https://agentage.co.uk', true],
    ['http://9.0.0.1:4000', 'http://127.0.0.1:4000', false],
    ['http://[::2]:4000', 'http://[::1]:4000', false],
  ])('%s for the site %s: %s', (issuer, site, allowed) => {
    expect(issuerAllowed(issuer, site)).toBe(allowed);
  });

  const doc = {
    issuer: 'https://auth.agentage.io/',
    platform: 'https://platform.next.agentage.io',
  };

  it("signs in at the discovery document's issuer", async () => {
    const target = await discoverTarget('next.agentage.io', serving(doc).get);
    expect(target.links.auth).toBe('https://auth.agentage.io');
    expect(target.discovered).toBe(true);
  });

  it('keeps auth.<fqdn> without a document, or without an issuer in it', async () => {
    expect((await discoverTarget('agentage.io', serving({}, 404).get)).links.auth).toBe(
      'https://auth.agentage.io'
    );
    const { get } = serving({ platform: doc.platform });
    expect((await discoverTarget('next.agentage.io', get)).links.auth).toBe(
      'https://auth.next.agentage.io'
    );
  });

  it('refuses an issuer outside the site', async () => {
    const { get } = serving({ ...doc, issuer: 'https://evil.com' });
    await expect(discoverTarget('next.agentage.io', get)).rejects.toThrow('names an issuer');
  });
});

describe('discoverTarget once per run', () => {
  it('shares one answer per fqdn with the default fetch', async () => {
    const [a, b] = await Promise.all([
      discoverTarget('once.invalid'),
      discoverTarget('once.invalid'),
    ]);
    expect(a).toBe(b);
    expect(a.discovered).toBe(false);
  });
});
