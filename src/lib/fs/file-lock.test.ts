import { execFile, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  // chmod-based unwritability does not apply to root, so skip these there.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(asRoot)('fails fast on a permission error instead of treating it as contention', () => {
    // An unwritable lock dir: writeFileSync({flag:'wx'}) throws EACCES/EPERM, which never clears.
    const roDir = join(dir, 'readonly');
    mkdirSync(roDir);
    const roTarget = join(roDir, 'data.json');
    chmodSync(roDir, 0o500);
    try {
      expect(() => acquireFileLock(roTarget)).toThrow(/permission denied/);
    } finally {
      chmodSync(roDir, 0o700);
    }
  });

  it.skipIf(asRoot)(
    'withFileLock surfaces a permission error immediately, never spinning MAX_WAIT_MS',
    async () => {
      const roDir = join(dir, 'readonly2');
      mkdirSync(roDir);
      const roTarget = join(roDir, 'data.json');
      chmodSync(roDir, 0o500);
      const started = Date.now();
      try {
        await expect(withFileLock(roTarget, () => 'unreachable')).rejects.toThrow(
          /permission denied/
        );
        expect(Date.now() - started).toBeLessThan(2_000);
      } finally {
        chmodSync(roDir, 0o700);
      }
    }
  );

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
    const deadPid = spawnSync(process.execPath, ['-e', '0']).pid; // spawned + reaped => pid is dead
    writeFileSync(lockFile(), `${deadPid} ${Date.now() - 11_000}`); // 11s old + dead pid = crashed
    const result = await withFileLock(target, () => 'recovered');
    expect(result).toBe('recovered');
    expect(existsSync(lockFile())).toBe(false);
  });

  it('refuses a stale-looking lock whose holder is still alive (never steals a slow holder)', () => {
    // A live-but-CPU-starved holder can look older than the TTL on a loaded CI runner. Stealing it
    // would put two writers in the critical section and drop an append (issue #249). It must refuse.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    try {
      writeFileSync(lockFile(), `${holder.pid} ${1_000_000}`);
      expect(acquireFileLock(target, 1_000_000 + 11_000)).toBe(false); // 11s old but pid is alive
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('never steals a lock whose content reads empty (mid-create window, issue #231)', () => {
    // The exact state a concurrent holderOf saw before the fix: the lock inode exists but its
    // "<pid> <at>" bytes are not there yet (create-then-write was non-atomic). Reading it yields
    // no parseable holder. Treating that as "absent/crashed" once let a fresh acquirer unlink a
    // live holder's lock and enter the critical section twice, silently dropping a write.
    writeFileSync(lockFile(), ''); // holderOf(...) === null, but the lock IS held
    expect(acquireFileLock(target, 1_000_000 + 11_000)).toBe(false); // past TTL, still must refuse
    expect(existsSync(lockFile())).toBe(true); // the live holder's lock was not stolen
  });

  it('lock content is always complete the instant the file appears (atomic create)', () => {
    // Poll the lock across many acquire/release cycles: a reader must never observe an empty or
    // half-written lock file. With the atomic link create the content is present before the inode is.
    for (let i = 0; i < 5_000; i++) {
      expect(acquireFileLock(target)).toBe(true);
      const parts = readFileSync(lockFile(), 'utf-8').trim().split(/\s+/);
      expect(parts).toHaveLength(2); // "<pid> <at>", never empty
      expect(Number.isNaN(Number.parseInt(parts[1]!, 10))).toBe(false);
      releaseFileLock(target);
    }
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
