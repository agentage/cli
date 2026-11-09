import { describe, expect, it } from 'vitest';
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

  it.each([
    ['no platform field', { issuer: 'x' }],
    ['a platform that is not a URL', { platform: 'nope' }],
  ])('refuses a served document with %s, naming it', async (_name, body) => {
    await expect(discoverPlatform('agentage.io', serving(body).get)).rejects.toThrow(
      'FAIL discovery: https://agentage.io/.well-known/agentage.json has no "platform"'
    );
  });
});
