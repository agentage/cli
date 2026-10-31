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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentTree } from '../loader/discover.js';
import {
  clearStaging,
  commitTree,
  discardTree,
  isComplete,
  pointCurrent,
  promoteFiles,
  readText,
  stageTree,
  treeName,
  treePath,
} from './tree.js';

describe('plugin trees', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-trees-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const files = { manifest: '{"name":"agentage-plugins"}\n', lock: '{"packages":{}}\n' };

  it('names a tree by the normalized lock: stable, 16 hex, distinct per set', () => {
    const name = treeName(['a@1.0.0+x', 'b@1.0.0+y']);
    expect(name).toMatch(/^[0-9a-f]{16}$/);
    expect(treeName(['a@1.0.0+x', 'b@1.0.0+y'])).toBe(name);
    expect(treeName([])).not.toBe(name);
  });

  it('stages under a dot name that plugins/current can never point at', () => {
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

  it('promotes manifest, lock and npm major to the plugins root', () => {
    promoteFiles(dir, { ...files, npmMajor: 10 });
    expect(readText(join(dir, 'package.json'))).toBe(files.manifest);
    expect(readText(join(dir, 'package-lock.json'))).toBe(files.lock);
    expect(readText(join(dir, 'npm-major'))).toBe('10\n');
    promoteFiles(dir, { ...files, npmMajor: null });
    expect(readText(join(dir, 'npm-major'))).toBe('10\n');
    promoteFiles(dir, { manifest: files.manifest, lock: null, npmMajor: null });
    expect(readdirSync(dir).sort()).toEqual(['package.json']);
    expect(readText(join(dir, 'missing'))).toBeNull();
  });
});
