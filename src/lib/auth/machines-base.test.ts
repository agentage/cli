import { describe, expect, it } from 'vitest';
import { machinesCall } from './machines-base.js';

const NEW = 'https://p.test/api/platform/machines';
const PLATFORM = { url: 'https://p.test', machines: NEW };

describe('machinesCall', () => {
  it('calls the machines base only, also on a 404: no second base (J.4.3 row 6)', async () => {
    const urls: string[] = [];
    const call = async (url: string) => (urls.push(url), new Response(null, { status: 404 }));
    expect((await machinesCall(PLATFORM, '/m_1/seen', call)).status).toBe(404);
    await machinesCall(PLATFORM, '/m_1', call);
    expect(urls).toEqual([`${NEW}/m_1/seen`, `${NEW}/m_1`]);
  });

  it('uses the api origin base when the site is not discovered', async () => {
    const urls: string[] = [];
    const call = async (url: string) => (urls.push(url), new Response(null, { status: 204 }));
    await machinesCall(
      { url: 'https://api.test', machines: 'https://api.test/v1/machines' },
      '/m_1',
      call
    );
    expect(urls).toEqual(['https://api.test/v1/machines/m_1']);
  });
});
