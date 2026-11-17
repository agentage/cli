import { afterEach, describe, expect, it } from 'vitest';
import { machinesCall } from './machines-base.js';
import { forgetRouteBases } from '../net/route-base.js';

const NEW = 'https://p.test/api/platform/machines';
const OLD = 'https://p.test/api/v1/machines';
const PLATFORM = { url: 'https://p.test', machines: NEW, fallback: OLD };

const envelope = (status: number, code?: string) =>
  new Response(code ? JSON.stringify({ success: false, error: { code } }) : null, { status });

// A host that serves the machines routes under `serves` only; `answer` is what the route says.
const host = (serves: string, answer = () => envelope(204)) => {
  const urls: string[] = [];
  const call = async (url: string) => {
    urls.push(url);
    return url.startsWith(serves) ? answer() : envelope(404, 'NOT_FOUND');
  };
  return { call, urls };
};

describe('machinesCall', () => {
  afterEach(forgetRouteBases);

  it('calls /api/platform/machines first on the app host, once per call', async () => {
    const { call, urls } = host(NEW);
    expect((await machinesCall(PLATFORM, '/m_1/seen', call)).status).toBe(204);
    await machinesCall(PLATFORM, '/m_1', call);
    expect(urls).toEqual([`${NEW}/m_1/seen`, `${NEW}/m_1`]);
  });

  it('falls back to /api/v1/machines on the v13 row, then stays there', async () => {
    const { call, urls } = host(OLD);
    expect((await machinesCall(PLATFORM, '/m_1/seen', call)).status).toBe(204);
    await machinesCall(PLATFORM, '/m_1', call);
    expect(urls).toEqual([`${NEW}/m_1/seen`, `${OLD}/m_1/seen`, `${OLD}/m_1`]);
  });

  it('keeps the route own 404 MACHINE_NOT_FOUND, with no fallback', async () => {
    const { call, urls } = host(NEW, () => envelope(404, 'MACHINE_NOT_FOUND'));
    const res = await machinesCall(PLATFORM, '/m_1/seen', call);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'MACHINE_NOT_FOUND' } });
    expect(urls).toEqual([`${NEW}/m_1/seen`]);
  });

  it('decides nothing on a 5xx: the next call tries /api/platform again', async () => {
    const { call, urls } = host(NEW, () => envelope(503));
    await machinesCall(PLATFORM, '/m_1', call);
    await machinesCall(PLATFORM, '/m_1', call);
    expect(urls).toEqual([`${NEW}/m_1`, `${NEW}/m_1`]);
  });

  it('answers the fallback 404 when neither base has the route, and remembers neither', async () => {
    const { call, urls } = host('https://other.test');
    expect((await machinesCall(PLATFORM, '/m_1', call)).status).toBe(404);
    await machinesCall(PLATFORM, '/m_1', call);
    expect(urls).toEqual([`${NEW}/m_1`, `${OLD}/m_1`, `${NEW}/m_1`, `${OLD}/m_1`]);
  });

  it('uses machines alone without a fallback (the api origin, not discovered)', async () => {
    const { call, urls } = host('https://api.test');
    await machinesCall(
      { url: 'https://api.test', machines: 'https://api.test/v1/machines' },
      '/m_1',
      call
    );
    expect(urls).toEqual(['https://api.test/v1/machines/m_1']);
  });

  it.each([401, 403, 429])(
    'a %i on the app host pins nothing: the next call can fall back',
    async (status) => {
      const answers = [envelope(status, 'FORBIDDEN'), envelope(404, 'NOT_FOUND'), envelope(204)];
      const urls: string[] = [];
      const call = async (url: string) => (urls.push(url), answers.shift() ?? envelope(204));
      expect((await machinesCall(PLATFORM, '/m_1', call)).status).toBe(status);
      expect((await machinesCall(PLATFORM, '/m_1', call)).status).toBe(204);
      expect(urls).toEqual([`${NEW}/m_1`, `${NEW}/m_1`, `${OLD}/m_1`]);
    }
  );

  it('a 400 with an unknown body pins nothing: the next call can fall back', async () => {
    const answers = [envelope(400), envelope(404, 'NOT_FOUND'), envelope(204)];
    const urls: string[] = [];
    const call = async (url: string) => (urls.push(url), answers.shift() ?? envelope(204));
    await machinesCall(PLATFORM, '/m_1', call);
    await machinesCall(PLATFORM, '/m_1', call);
    expect(urls).toEqual([`${NEW}/m_1`, `${NEW}/m_1`, `${OLD}/m_1`]);
  });
});
