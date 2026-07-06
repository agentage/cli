import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireFileLock, releaseFileLock, withFileLock } from './file-lock.js';

describe('file lock', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-filelock-'));
    target = join(dir, 'data.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const lockFile = (): string => `${target}.lock`;

  it('acquires when no lock is held', () => {
    expect(acquireFileLock(target)).toBe(true);
    expect(existsSync(lockFile())).toBe(true);
    releaseFileLock(target);
  });

  it('refuses when a fresh lock is already held', () => {
    const now = 1_000_000;
    expect(acquireFileLock(target, now)).toBe(true);
    expect(acquireFileLock(target, now + 5_000)).toBe(false); // 5s later, within the 10s TTL
    releaseFileLock(target);
  });

  it('takes over a stale lock (older than the 10s TTL)', () => {
    const now = 1_000_000;
    expect(acquireFileLock(target, now)).toBe(true);
    expect(acquireFileLock(target, now + 11_000)).toBe(true); // 11s later, stale
    releaseFileLock(target);
  });

  it('releases idempotently', () => {
    acquireFileLock(target);
    releaseFileLock(target);
    releaseFileLock(target);
    expect(existsSync(lockFile())).toBe(false);
  });

  it('runs fn while holding the lock and releases it after', async () => {
    const result = await withFileLock(target, () => {
      expect(existsSync(lockFile())).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(existsSync(lockFile())).toBe(false);
  });

  it('releases the lock even when fn throws (finally path)', async () => {
    await expect(
      withFileLock(target, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(existsSync(lockFile())).toBe(false);
  });

  it('takes over a stale lock left by a crashed holder, never wedging', async () => {
    writeFileSync(lockFile(), `999 ${Date.now() - 11_000}`); // 11s old = crashed holder
    const result = await withFileLock(target, () => 'recovered');
    expect(result).toBe('recovered');
    expect(existsSync(lockFile())).toBe(false);
  });

  it('serializes many concurrent in-process read-modify-writes, losing none', async () => {
    writeFileSync(target, JSON.stringify([]));
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        withFileLock(target, () => {
          const arr = JSON.parse(readFileSync(target, 'utf-8')) as number[];
          arr.push(i);
          writeFileSync(target, JSON.stringify(arr));
        })
      )
    );
    const arr = JSON.parse(readFileSync(target, 'utf-8')) as number[];
    expect(arr.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  // Real OS processes racing the exact read-modify-write shape from issue #231. Each child appends
  // its id to one shared JSON array through withFileLock; a lockless RMW drops appends whose read
  // raced another writer's write. The transpiled module has no non-builtin imports.
  const raceAppends = async (count: number): Promise<string[]> => {
    const libDir = join(dir, 'lib');
    mkdirSync(libDir, { recursive: true });
    const out = ts.transpileModule(
      readFileSync(join(import.meta.dirname, 'file-lock.ts'), 'utf-8'),
      {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }
    ).outputText;
    writeFileSync(join(libDir, 'file-lock.js'), out, 'utf-8');
    const mod = pathToFileURL(join(libDir, 'file-lock.js')).href;
    const script = join(dir, 'race.mjs');
    writeFileSync(
      script,
      `import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n` +
        `import { withFileLock } from '${mod}';\n` +
        `const [, , target, id] = process.argv;\n` +
        `await withFileLock(target, () => {\n` +
        `  const arr = existsSync(target) ? JSON.parse(readFileSync(target, 'utf-8')) : [];\n` +
        `  const until = Date.now() + 3;\n` + // widen the read->write gap a lockless RMW would lose
        `  while (Date.now() < until) {}\n` +
        `  arr.push(Number(id));\n` +
        `  writeFileSync(target, JSON.stringify(arr));\n` +
        `});\n` +
        `process.stdout.write('ok');\n`,
      'utf-8'
    );
    return Promise.all(
      Array.from(
        { length: count },
        (_, i) =>
          new Promise<string>((resolve) => {
            execFile(process.execPath, [script, target, String(i)], {}, (_e, stdout) =>
              resolve(stdout)
            );
          })
      )
    );
  };

  it('20 concurrent processes each land their append, zero lost, no leftover lock', async () => {
    writeFileSync(target, JSON.stringify([]));
    const runs = await raceAppends(20);
    expect(runs.filter((r) => r === 'ok')).toHaveLength(20);
    const arr = JSON.parse(readFileSync(target, 'utf-8')) as number[];
    expect(arr.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(existsSync(lockFile())).toBe(false);
  }, 30_000);
});
