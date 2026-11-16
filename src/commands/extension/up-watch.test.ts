import { chmodSync, existsSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { prepareStage, seedNext, upModeOf } from './up-build.js';
import { coalesced, runRest, watchFolder, watchTsc, type TscBuilt } from './up-watch.js';

// A stand-in for the folder's tsc: one first build, then a change with an error, then a clean one.
const FAKE_TSC = `#!/usr/bin/env node
const out = (line) => console.log(line);
out(process.argv.slice(2).join(' '));
out('[10:00:00] Starting compilation in watch mode...');
out('[10:00:01] Found 0 errors. Watching for file changes.');
out('[10:00:02] File change detected. Starting incremental compilation...');
out("src/api/index.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.");
out('[10:00:03] Found 1 error. Watching for file changes.');
out('[10:00:04] File change detected. Starting incremental compilation...');
out('[10:00:05] Found 0 errors. Watching for file changes.');
setTimeout(() => {}, 10_000);
`;

const pkg = (build?: string) => ({ name: 'x', agentage: { id: 'x' }, scripts: { build } });

describe('the build mode of extension up (D13 revised)', () => {
  test('plain tsc with the folder tsc watches; anything else, or no tsc in the folder, is staged', ({
    dir,
  }) => {
    dir.write('t/package.json', pkg('tsc -p tsconfig.build.json && agentage-widget bundle'));
    expect(upModeOf(dir.at('t'))).toEqual({ kind: 'stage', script: expect.any(String) });
    dir.write('t/node_modules/.bin/tsc', '');
    expect(upModeOf(dir.at('t'))).toEqual({
      kind: 'tsc',
      tsc: join(dir.at('t'), 'node_modules/.bin/tsc'),
      config: 'tsconfig.build.json',
      rest: 'agentage-widget bundle',
    });
    dir.write('t/package.json', pkg('tsc'));
    expect(upModeOf(dir.at('t'))).toMatchObject({
      kind: 'tsc',
      config: 'tsconfig.json',
      rest: null,
    });
    dir.write('t/package.json', pkg('tsc -b && node x.mjs'));
    expect(upModeOf(dir.at('t'))).toMatchObject({ kind: 'stage' });
    dir.write('t/package.json', { name: 'x' });
    expect(upModeOf(dir.at('t'))).toEqual({ kind: 'stage', script: null });
  });

  test('the stage copies the folder but node_modules (linked), dist, dist.next, .agentage, .git', ({
    dir,
  }) => {
    for (const path of ['src/a.js', 'dist/a.js', 'dist.next/a.js', '.git/HEAD', 'build.mjs'])
      dir.write(`w/${path}`, '');
    dir.write('w/node_modules/m/index.js', '');
    const stage = prepareStage(dir.at('w'));
    expect(existsSync(join(stage, 'src/a.js'))).toBe(true);
    expect(existsSync(join(stage, 'build.mjs'))).toBe(true);
    for (const gone of ['dist', 'dist.next', '.git', '.agentage'])
      expect(existsSync(join(stage, gone)), gone).toBe(false);
    expect(readlinkSync(join(stage, 'node_modules'))).toBe(join(dir.at('w'), 'node_modules'));
    seedNext(dir.at('w'));
    expect(existsSync(join(dir.at('w'), 'dist.next/a.js'))).toBe(true);
  });
});

describe('the watchers of extension up', () => {
  test('tsc: out to dist.next with noEmitOnError; each build reported, the first marked; errors to stderr', async ({
    dir,
  }) => {
    dir.write('t/node_modules/.bin/tsc', FAKE_TSC);
    const tsc = join(dir.at('t'), 'node_modules/.bin/tsc');
    chmodSync(tsc, 0o755);
    const built: TscBuilt[] = [];
    const run = await output(async () => {
      const mode = { kind: 'tsc' as const, tsc, config: 'tsconfig.build.json', rest: null };
      const watcher = watchTsc(dir.at('t'), mode, (b) => built.push(b));
      await vi.waitFor(() => expect(built).toHaveLength(3), { timeout: 5_000 });
      watcher.stop();
    });
    expect(built.map(({ errors, first }) => [errors, first])).toEqual([
      [0, true],
      [1, false],
      [0, false],
    ]);
    expect(run.stderr).toContain('error TS2322');
  });

  test('a folder watch debounces saves into one change; a missing folder watches nothing', async ({
    dir,
  }) => {
    dir.write('w/src/a.js', '');
    const seen = vi.fn();
    const watcher = watchFolder(dir.at('w/src'), seen, 100);
    writeFileSync(dir.at('w/src/a.js'), '1');
    writeFileSync(dir.at('w/src/a.js'), '2');
    await vi.waitFor(() => expect(seen).toHaveBeenCalledOnce(), { timeout: 3_000 });
    watcher.stop();
    expect(() => watchFolder(dir.at('none'), seen).stop()).not.toThrow();
  });

  test('one run at a time: calls during a run give one more run, not one each', async () => {
    let runs = 0;
    let release = (): void => undefined;
    const go = coalesced(
      () =>
        new Promise<void>((done) => {
          runs += 1;
          release = done;
        })
    );
    const first = go();
    void go();
    void go();
    release();
    await vi.waitFor(() => expect(runs).toBe(2));
    release();
    await first;
    expect(runs).toBe(2);
  });

  test('the rest of the build script runs in the folder with its node_modules/.bin on PATH', async ({
    dir,
  }) => {
    dir.write('w/node_modules/.bin/bundle', '#!/bin/sh\necho ok > made.txt\n');
    chmodSync(dir.at('w/node_modules/.bin/bundle'), 0o755);
    expect(await runRest(dir.at('w'), 'bundle')).toBe(true);
    expect(dir.exists('w/made.txt')).toBe(true);
    expect(await runRest(dir.at('w'), 'exit 3')).toBe(false);
  });
});
