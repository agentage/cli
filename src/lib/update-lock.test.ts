import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigDir } from './config.js';
import { acquireUpdateLock, releaseUpdateLock } from './update-lock.js';

const lockFile = (): string => join(getConfigDir(), 'update.lock');

describe('update lock', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-lock-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires when no lock is held', () => {
    expect(acquireUpdateLock()).toBe(true);
    expect(existsSync(lockFile())).toBe(true);
  });

  it('refuses when a fresh lock is already held', () => {
    const now = 1_000_000;
    expect(acquireUpdateLock(now)).toBe(true);
    expect(acquireUpdateLock(now + 60_000)).toBe(false); // 1 min later, still within TTL
  });

  it('overrides a stale lock (older than the 10-minute TTL)', () => {
    const now = 1_000_000;
    expect(acquireUpdateLock(now)).toBe(true);
    expect(acquireUpdateLock(now + 11 * 60_000)).toBe(true); // 11 min later, stale
  });

  it('releases idempotently', () => {
    acquireUpdateLock();
    releaseUpdateLock();
    releaseUpdateLock();
    expect(existsSync(lockFile())).toBe(false);
  });

  // The TOCTOU proof: real concurrent PROCESSES running the actual module, transpiled on the fly
  // (a check-then-write lock lets most of them win; the O_EXCL create admits exactly one).
  const raceProcesses = async (count: number, now: number): Promise<string[]> => {
    const libDir = join(dir, 'lib');
    mkdirSync(libDir, { recursive: true });
    for (const src of ['config.ts', 'file-lock.ts', 'update-lock.ts']) {
      const out = ts.transpileModule(readFileSync(join(import.meta.dirname, src), 'utf-8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      writeFileSync(join(libDir, basename(src).replace(/\.ts$/, '.js')), out, 'utf-8');
    }
    const script = join(dir, 'race.mjs');
    const mod = pathToFileURL(join(libDir, 'update-lock.js')).href;
    writeFileSync(
      script,
      `import { acquireUpdateLock } from '${mod}';\n` +
        `process.stdout.write(acquireUpdateLock(${now}) ? '1' : '0');\n`,
      'utf-8'
    );
    const env = { ...process.env, AGENTAGE_CONFIG_DIR: join(dir, 'cfg') };
    return Promise.all(
      Array.from(
        { length: count },
        () =>
          new Promise<string>((resolve) => {
            execFile(process.execPath, [script], { env }, (_err, stdout) => resolve(stdout));
          })
      )
    );
  };

  it('exactly one of many concurrent processes wins the lock', async () => {
    const runs = await raceProcesses(12, 1_000_000);
    expect(runs.filter((r) => r === '1')).toHaveLength(1);
  }, 20_000);

  it('exactly one of many concurrent processes takes over a STALE lock', async () => {
    // The ABA proof: a naive unlink-takeover lets a taker delete the fresh winner's lock and
    // re-win; the rename takeover admits exactly one.
    const now = 1_000_000;
    mkdirSync(join(dir, 'cfg'), { recursive: true });
    writeFileSync(lockFile(), String(now - 11 * 60_000), 'utf-8'); // >10min old = stale
    const runs = await raceProcesses(12, now);
    expect(runs.filter((r) => r === '1')).toHaveLength(1);
  }, 20_000);
});
