import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmIn } from './package-build.js';

// npm-cli.js as a node script; npmIn runs it with this node, as `node npm-cli.js` runs npm.
let bin: string;
const cli = (): string => join(bin, 'npm-cli.js');
const fakeNpm = (script: string): void => writeFileSync(cli(), `${script}\n`);
const npm = (args: string[], timeoutMs?: number, graceMs?: number) =>
  npmIn(bin, args, timeoutMs, graceMs, cli);

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'agentage-npm-'));
});

afterEach(() => rmSync(bin, { recursive: true, force: true }));

describe('npm in a working copy (create, build, up)', () => {
  it('exit 0 resolves', async () => {
    fakeNpm('process.exit(0)');
    await expect(npm(['run', 'build'])).resolves.toBeUndefined();
  });

  it('another exit code is build_failed naming the step, the folder and the code', async () => {
    fakeNpm('process.exit(3)');
    await expect(npm(['run', 'build'])).rejects.toMatchObject({
      code: 'build_failed',
      message: `npm run build in ${bin} exited 3`,
    });
  });

  it('a step past its time gets SIGTERM and build_failed says so', async () => {
    fakeNpm('setTimeout(() => {}, 5000)');
    await expect(npm(['ci'], 200)).rejects.toMatchObject({
      code: 'build_failed',
      message: `npm ci in ${bin} did not finish in 0.2 s; stopped (exited by signal SIGTERM)`,
    });
  });

  it('a step that ignores SIGTERM gets SIGKILL after the grace time', async () => {
    fakeNpm("process.on('SIGTERM', () => {}); setInterval(() => {}, 50)");
    await expect(npm(['ci'], 200, 300)).rejects.toMatchObject({
      message: `npm ci in ${bin} did not finish in 0.2 s; stopped (exited by signal SIGKILL)`,
    });
  });

  it('a step stopped by another signal names it, never "exited null"', async () => {
    fakeNpm("process.kill(process.pid, 'SIGINT')");
    await expect(npm(['ci'])).rejects.toMatchObject({
      message: `npm ci in ${bin} exited by signal SIGINT`,
    });
  });

  it('no npm-cli.js is build_failed, not a raw spawn error', async () => {
    const none = () => {
      throw new Error('npm-cli.js not found next to node');
    };
    await expect(npmIn(bin, ['ci'], 200, 300, none)).rejects.toMatchObject({
      code: 'build_failed',
      message: `npm ci in ${bin} did not start: npm-cli.js not found next to node`,
    });
  });
});
