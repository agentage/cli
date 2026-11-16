import { describe, expect, test, vi } from 'vitest';
import { output } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { lane, reload, RELOAD_STRIKES, stageAndReload, tscReloads } from './up-reload.js';

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

describe('up stops instead of sitting silent (reliability)', () => {
  test('three failed reload calls in a row stop up once; a good answer resets the count', async () => {
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const fatal = vi.fn();
    const run = { dir: '.', id: 'demo', host: fake.host, npm: async () => undefined, fatal };
    vi.mocked(fake.host.reload).mockRejectedValue(new Error('the daemon on 127.0.0.1:1: refused'));
    const printed = await output(async () => {
      await reload(run, Date.now());
      await reload(run, Date.now());
      vi.mocked(fake.host.reload).mockResolvedValueOnce({
        id: 'demo',
        version: '0.1.0',
        state: 'running',
        reloaded: false,
        refused: 'the new child did not start',
      });
      await reload(run, Date.now());
      for (let i = 0; i < RELOAD_STRIKES; i += 1) await reload(run, Date.now());
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal).toHaveBeenCalledWith('the reload failed 3 times in a row', 'daemon_unavailable');
    expect(printed.stderr).toContain('reload    demo failed: the daemon on 127.0.0.1:1: refused');
    expect(
      printed.lines.filter((l) => l.includes('refused: the new child did not start'))
    ).toHaveLength(1);
  });

  test('a build tool that cannot run stops up; a compile error does not', async () => {
    const fatal = vi.fn();
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const failing = (why: string) => ({
      dir: '/nowhere',
      id: 'demo',
      host: fake.host,
      npm: async () => {
        throw new Error(why);
      },
      fatal,
    });
    await output(() => stageAndReload(failing('npm run build in /s exited 2')));
    expect(fatal).not.toHaveBeenCalled();
    await output(() => stageAndReload(failing('npm run build in /s exited 127')));
    await output(() => stageAndReload(failing('npm run build in /s did not start: ENOENT')));
    expect(fatal).toHaveBeenCalledTimes(2);
    expect(fatal).toHaveBeenCalledWith('the build tool is missing (npm ci installs it)');
    expect(fake.host.reload).not.toHaveBeenCalled();
  });
});
