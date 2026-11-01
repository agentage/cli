import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireFileLock, releaseFileLock } from '../../lib/fs/file-lock.js';
import { currentTree } from '../loader/discover.js';
import {
  clearStaging,
  commitTree,
  discardTree,
  isComplete,
  MANIFEST_NAME,
  manifestText,
  pointCurrent,
  promoteFiles,
  readText,
  stageTree,
  treeName,
  treePath,
  withInstallLock,
} from './tree.js';

describe('extension trees', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-trees-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const files = { manifest: '{"name":"agentage-extensions"}\n', lock: '{"packages":{}}\n' };

  it('names a tree by the normalized lock: stable, 16 hex, distinct per set', () => {
    const name = treeName(['a@1.0.0+x', 'b@1.0.0+y']);
    expect(name).toMatch(/^[0-9a-f]{16}$/);
    expect(treeName(['a@1.0.0+x', 'b@1.0.0+y'])).toBe(name);
    expect(treeName([])).not.toBe(name);
  });

  it('stages under a dot name that extensions/current can never point at', () => {
    const staging = stageTree(dir, files);
    expect(staging.startsWith(join(dir, 'trees', '.staging-'))).toBe(true);
    expect(readdirSync(staging).sort()).toEqual(['package-lock.json', 'package.json']);
    expect(readText(join(staging, 'package.json'))).toBe(files.manifest);
    expect(readdirSync(stageTree(dir, { ...files, lock: null }))).toEqual(['package.json']);
  });

  it('commits with .complete in place, then the pointer names it for the loader', () => {
    const staging = stageTree(dir, files);
    commitTree(dir, staging, 'abc123');
    expect(existsSync(staging)).toBe(false);
    expect(isComplete(dir, 'abc123')).toBe(true);
    pointCurrent(dir, 'abc123');
    expect(readFileSync(join(dir, 'current'), 'utf-8')).toBe('abc123\n');
    expect(statSync(join(dir, 'current')).mode & 0o777).toBe(0o600);
    expect(currentTree(dir)).toEqual({ dir: treePath(dir, 'abc123'), warning: null });
  });

  it('keeps an existing complete tree and drops the new staging copy', () => {
    commitTree(dir, stageTree(dir, files), 'same');
    const marker = join(treePath(dir, 'same'), 'marker');
    writeFileSync(marker, '');
    const second = stageTree(dir, files);
    commitTree(dir, second, 'same');
    expect(existsSync(second)).toBe(false);
    expect(existsSync(marker)).toBe(true);
  });

  it('replaces an unfinished leftover with the same name', () => {
    mkdirSync(join(treePath(dir, 'half'), 'node_modules'), { recursive: true });
    commitTree(dir, stageTree(dir, files), 'half');
    expect(readdirSync(treePath(dir, 'half')).sort()).toEqual([
      '.complete',
      'package-lock.json',
      'package.json',
    ]);
  });

  it('discards a staging dir and clears ones a dead run left', () => {
    clearStaging(dir);
    const a = stageTree(dir, files);
    discardTree(a);
    expect(existsSync(a)).toBe(false);
    stageTree(dir, files);
    commitTree(dir, stageTree(dir, files), 'kept');
    clearStaging(dir);
    expect(readdirSync(join(dir, 'trees'))).toEqual(['kept']);
  });

  it('promotes manifest and lock to the extensions root, dropping a lock the tree lacks', () => {
    promoteFiles(dir, files);
    expect(readText(join(dir, 'package.json'))).toBe(files.manifest);
    expect(readText(join(dir, 'package-lock.json'))).toBe(files.lock);
    promoteFiles(dir, { manifest: files.manifest, lock: null });
    expect(readdirSync(dir).sort()).toEqual(['package.json']);
    expect(readText(join(dir, 'missing'))).toBeNull();
  });

  it('writes the same private, sorted, script-free manifest for the same set', () => {
    const a = manifestText({ '@agentage/z': '^1', '@agentage/a': '~1.2' });
    expect(manifestText({ '@agentage/a': '~1.2', '@agentage/z': '^1' })).toBe(a);
    expect(a.endsWith('}\n')).toBe(true);
    expect(JSON.parse(a)).toEqual({
      name: MANIFEST_NAME,
      private: true,
      dependencies: { '@agentage/a': '~1.2', '@agentage/z': '^1' },
    });
  });
});

describe('withInstallLock (R8)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-install-lock-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const lockFile = (): string => join(dir, 'install.lock');

  it('holds install.lock with this pid during the body and refreshes it on a heartbeat', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const stamps = await withInstallLock(dir, async () => {
      const first = readFileSync(lockFile(), 'utf-8');
      await vi.advanceTimersByTimeAsync(20_000);
      return [first, readFileSync(lockFile(), 'utf-8')];
    });
    expect(stamps).toEqual([`${process.pid} 1000`, `${process.pid} 21000`]);
    expect(existsSync(lockFile())).toBe(false);
  });

  it('waits for a live holder, saying so once on stderr', async () => {
    const target = join(dir, 'install');
    expect(acquireFileLock(target)).toBe(true);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      setTimeout(() => releaseFileLock(target), 300);
      await expect(withInstallLock(dir, async () => 'after')).resolves.toBe('after');
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledWith(`waiting for another install to finish (${target}.lock)`);
    } finally {
      stderr.mockRestore();
    }
  });

  it('takes over a lock left by a crashed run and releases on throw', async () => {
    writeFileSync(lockFile(), '999999 1');
    await expect(withInstallLock(dir, () => Promise.reject(new Error('npm')))).rejects.toThrow(
      'npm'
    );
    expect(existsSync(lockFile())).toBe(false);
  });
});
