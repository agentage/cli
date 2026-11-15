import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmIn } from './package-build.js';

// A folder whose `npm` is a shell script, put first on the PATH the child inherits.
let bin: string;
const path = process.env['PATH'];

const fakeNpm = (script: string): void => {
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, 'npm'), 0o755);
};

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'agentage-npm-'));
  process.env['PATH'] = `${bin}:${path}`;
});

afterEach(() => {
  process.env['PATH'] = path;
  rmSync(bin, { recursive: true, force: true });
});

describe('npm in a working copy (create, build, up)', () => {
  it('exit 0 resolves', async () => {
    fakeNpm('exit 0');
    await expect(npmIn(bin, ['run', 'build'])).resolves.toBeUndefined();
  });

  it('another exit code is build_failed naming the step, the folder and the code', async () => {
    fakeNpm('exit 3');
    await expect(npmIn(bin, ['run', 'build'])).rejects.toMatchObject({
      code: 'build_failed',
      message: `npm run build in ${bin} exited 3`,
    });
  });

  it('a step past its time gets SIGTERM and build_failed says so', async () => {
    fakeNpm('exec sleep 5');
    await expect(npmIn(bin, ['ci'], 200)).rejects.toMatchObject({
      code: 'build_failed',
      message: `npm ci in ${bin} did not finish in 0.2 s; stopped (exited by signal SIGTERM)`,
    });
  });

  it('a step that ignores SIGTERM gets SIGKILL after the grace time', async () => {
    fakeNpm(`trap '' TERM; while :; do sleep 0.05; done`);
    await expect(npmIn(bin, ['ci'], 200, 300)).rejects.toMatchObject({
      message: `npm ci in ${bin} did not finish in 0.2 s; stopped (exited by signal SIGKILL)`,
    });
  });

  it('a step stopped by another signal names it, never "exited null"', async () => {
    fakeNpm('kill -INT $$');
    await expect(npmIn(bin, ['ci'])).rejects.toMatchObject({
      message: `npm ci in ${bin} exited by signal SIGINT`,
    });
  });

  it('no npm on the PATH is build_failed, not a raw spawn error', async () => {
    process.env['PATH'] = bin;
    await expect(npmIn(bin, ['ci'])).rejects.toMatchObject({
      code: 'build_failed',
      message: expect.stringMatching(/^npm ci in .* did not start: spawn npm ENOENT$/),
    });
  });
});
