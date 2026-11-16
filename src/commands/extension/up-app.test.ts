import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import type { AppBuilder } from '@agentage/extension/tool';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { appAndReload, hasAppPart, startAppBuilder } from './up-app.js';
import { startWatch, type Run } from './up-reload.js';

const APP_PKG = {
  name: 'demo',
  agentage: { id: 'demo', parts: { api: true, app: true } },
  scripts: { build: 'node build.mjs' },
};

// A stand-in for the kit's warm build: writes dist/app as the kit does, or throws once asked.
const fakeBuilder = (dir: string, write: (path: string, v: unknown) => void, fail = false) => {
  let n = 0;
  const builder: AppBuilder = {
    rebuild: vi.fn(async () => {
      if (fail) throw new Error('src/app/index.tsx: Expected ";"');
      n += 1;
      const files = { entry: `app-${n}.js`, css: `app-${n}.css` };
      write(`${dir}/dist/app/${files.entry}`, `export default ${n};`);
      write(`${dir}/dist/app/app.json`, files);
      return files;
    }),
    dispose: vi.fn(async () => undefined),
  };
  return builder;
};

describe('extension up and the app part (S1.2.3 row 4)', () => {
  test('a package with parts.app has an app part; others none and no builder', async ({ dir }) => {
    dir.write('w/package.json', APP_PKG);
    dir.write('p/package.json', { name: 'p', agentage: { id: 'p', parts: { api: true } } });
    expect(hasAppPart(dir.at('w'))).toBe(true);
    expect(hasAppPart(dir.at('p'))).toBe(false);
    const tool = vi.fn();
    expect(await startAppBuilder(dir.at('p'), tool)).toBeNull();
    expect(tool).not.toHaveBeenCalled();
  });

  test('a save builds dist/app, copies it into dist.next/app, sends { part: app } once', async ({
    dir,
  }) => {
    dir.write('w/package.json', APP_PKG);
    dir.write('w/dist.next/app/app-0.js', 'old');
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const run: Run = { dir: dir.at('w'), id: 'demo', host: fake.host, npm: vi.fn() };
    const out = await output(() => appAndReload(run, fakeBuilder('w', dir.write)));
    expect(fake.host.reload).toHaveBeenCalledExactlyOnceWith('demo', 'app');
    expect(readFileSync(dir.at('w/dist.next/app/app.json'), 'utf8')).toContain('app-1.js');
    expect(existsSync(dir.at('w/dist.next/app/app-0.js'))).toBe(false);
    expect(out.stdout).toMatch(/app {7}demo reloaded in \d+ ms \(the child keeps running\)/);
    expect(run.npm).not.toHaveBeenCalled();
  });

  test('a failed app build sends no reload and leaves dist.next/app as it was', async ({ dir }) => {
    dir.write('w/package.json', APP_PKG);
    dir.write('w/dist.next/app/app.json', { entry: 'app-0.js', css: 'app-0.css' });
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const run: Run = { dir: dir.at('w'), id: 'demo', host: fake.host, npm: vi.fn() };
    const out = await output(() => appAndReload(run, fakeBuilder('w', dir.write, true)));
    expect(fake.host.reload).not.toHaveBeenCalled();
    expect(out.stderr).toContain('app       build failed, no reload: src/app/index.tsx');
    expect(readFileSync(dir.at('w/dist.next/app/app.json'), 'utf8')).toContain('app-0.js');
  });

  test('the watch: a save in src/app reloads the app part, a save in src/api the child', async ({
    dir,
  }) => {
    dir.write('w/package.json', APP_PKG);
    dir.write('w/src/api/index.js', 'export {};');
    dir.write('w/src/app/index.tsx', 'export default () => null;');
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const npm = vi.fn(async () => undefined);
    const app = fakeBuilder('w', dir.write);
    const run: Run = { dir: dir.at('w'), id: 'demo', host: fake.host, npm, app };
    const { watchers } = startWatch(run, { kind: 'stage', script: 'node build.mjs' }, () => {});
    await output(async () => {
      try {
        dir.write('w/src/app/index.tsx', 'export default () => "two";');
        await vi.waitFor(() => expect(fake.host.reload).toHaveBeenCalledWith('demo', 'app'));
        expect(npm).not.toHaveBeenCalled();
        dir.write('w/src/api/index.js', 'export const v = 2;');
        await vi.waitFor(() => expect(npm).toHaveBeenCalledTimes(1), { timeout: 5_000 });
        await vi.waitFor(() => expect(fake.host.reload).toHaveBeenLastCalledWith('demo'));
      } finally {
        for (const w of watchers) w.stop();
      }
    });
    expect(fake.host.reload).toHaveBeenCalledTimes(2);
    expect(app.rebuild).toHaveBeenCalledTimes(1);
  });

  test('a save in src/app after up began and before the watch is built at the start', async ({
    dir,
  }) => {
    dir.write('w/package.json', APP_PKG);
    dir.write('w/src/app/index.tsx', 'export default () => "saved early";');
    const fake = fakeHost([marketRow('demo', '0.1.0')]);
    const app = fakeBuilder('w', dir.write);
    const run: Run = { dir: dir.at('w'), id: 'demo', host: fake.host, npm: vi.fn(), app };
    run.builtAt = Date.now() - 60_000;
    const { watchers } = startWatch(run, { kind: 'stage', script: null }, () => {});
    await output(async () => {
      try {
        await vi.waitFor(() => expect(fake.host.reload).toHaveBeenCalledWith('demo', 'app'));
      } finally {
        for (const w of watchers) w.stop();
      }
    });
    expect(app.rebuild).toHaveBeenCalledOnce();
  });

  test('the kit builder with the cli copy of esbuild and tailwind writes dist/app', async ({
    dir,
  }) => {
    dir.write('w/package.json', APP_PKG);
    const tsx = 'export default function App() {\n  return <h1 className="p-2">Demo</h1>;\n}\n';
    dir.write('w/src/app/index.tsx', tsx);
    const builder = await startAppBuilder(dir.at('w'));
    expect(builder).not.toBeNull();
    try {
      const files = await builder!.rebuild();
      expect(existsSync(join(dir.at('w/dist/app'), files.entry))).toBe(true);
      expect(readFileSync(dir.at('w/dist/app/index.js'), 'utf8')).toContain(files.entry);
    } finally {
      await builder!.dispose();
    }
  }, 30_000);
});
