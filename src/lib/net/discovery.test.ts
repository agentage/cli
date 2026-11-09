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
  it('reads /.well-known/agentage.json on the site and returns its platform', async () => {
    const { get, urls } = serving({
      issuer: 'https://auth.next.agentage.io',
      platform: 'https://platform.next.agentage.io/',
    });
    expect(await discoverPlatform('next.agentage.io', get)).toBe(
      'https://platform.next.agentage.io'
    );
    expect(urls).toEqual(['https://next.agentage.io/.well-known/agentage.json']);
  });

  it.each([
    ['no platform field', serving({ issuer: 'x' })],
    ['a platform that is not a URL', serving({ platform: 'nope' })],
    ['a missing document', serving({}, 404)],
  ])('refuses %s naming the document', async (_name, { get }) => {
    await expect(discoverPlatform('agentage.io', get)).rejects.toThrow(
      'FAIL discovery: https://agentage.io/.well-known/agentage.json has no "platform"'
    );
  });

  it('refuses an unreachable site the same way', async () => {
    const get = () => Promise.reject(new TypeError('fetch failed'));
    await expect(discoverPlatform('agentage.io', get)).rejects.toThrow('has no "platform"');
  });
});
