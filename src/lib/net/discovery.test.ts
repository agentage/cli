import { describe, expect, it, vi } from 'vitest';
import { discoverPlatform } from './discovery.js';

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
