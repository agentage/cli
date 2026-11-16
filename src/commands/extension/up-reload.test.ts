import { describe, expect, test, vi } from 'vitest';
import { output } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { lane, tscReloads } from './up-reload.js';

const clean = (first = false) => ({ errors: 0, ms: 5, first });

describe('reloads after tsc builds (item 7)', () => {
  test('never two at once; a build that ends during a reload gives exactly one more', async () => {
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    let inFlight = 0;
    let most = 0;
    let release: () => void = () => undefined;
    vi.mocked(fake.host.reload).mockImplementation(async (id) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise<void>((done) => (release = done));
      inFlight -= 1;
      return { id, version: '0.1.0', state: 'running', reloaded: true };
    });
    const run = { dir: '.', id: 'demo', host: fake.host, npm: async () => undefined };
    await output(async () => {
      const reloads = tscReloads(run, lane());
      reloads.onBuilt(clean(true));
      reloads.onBuilt(clean());
      await vi.waitFor(() => expect(fake.host.reload).toHaveBeenCalledTimes(1));
      reloads.onChange();
      reloads.onBuilt(clean());
      reloads.onChange();
      reloads.onBuilt(clean());
      release();
      await vi.waitFor(() => expect(fake.host.reload).toHaveBeenCalledTimes(2));
      release();
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(fake.host.reload).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });

  test('no reload while tsc writes the next build; it goes once that build is clean', async () => {
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const run = { dir: '.', id: 'demo', host: fake.host, npm: async () => undefined };
    const out = await output(async () => {
      const reloads = tscReloads(run, lane());
      reloads.onChange();
      reloads.onBuilt({ errors: 2, ms: 5, first: false });
      reloads.onChange();
      await new Promise((done) => setTimeout(done, 20));
      expect(fake.host.reload).not.toHaveBeenCalled();
      reloads.onBuilt(clean());
      await vi.waitFor(() => expect(fake.host.reload).toHaveBeenCalledOnce());
    });
    expect(out.stderr).toContain('build     2 error(s), no reload');
  });
});
