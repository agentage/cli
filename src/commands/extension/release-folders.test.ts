import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extensionFolders, writeCiCopy } from './release-folders.js';

const tree = (files: Record<string, unknown>): string => {
  const root = mkdtempSync(join(tmpdir(), 'agentage-folders-'));
  for (const [rel, value] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
};

const ext = (id: string) => ({
  name: `@agentage/extension-${id}`,
  version: '0.0.0',
  agentage: { id },
});

const json = (root: string, rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;

describe('extension folders', () => {
  it('each extensions/<name> with an agentage package, sorted; others are skipped', async () => {
    const root = tree({
      'package.json': { name: 'examples', private: true },
      'extensions/probe/package.json': ext('probe'),
      'extensions/fixture/package.json': ext('fixture'),
      'extensions/notes/README.md': 'not an extension',
      'extensions/lib/package.json': { name: 'lib' },
      'extensions/file.txt': 'x',
    });
    expect(await extensionFolders(root)).toEqual([
      { rel: 'extensions/fixture', id: 'fixture' },
      { rel: 'extensions/probe', id: 'probe' },
    ]);
  });

  it('one extension at the root when there is no extensions/*', async () => {
    expect(await extensionFolders(tree({ 'package.json': ext('root') }))).toEqual([
      { rel: '.', id: 'root' },
    ]);
  });

  it('none: no extension package anywhere', async () => {
    expect(await extensionFolders(tree({ 'package.json': { name: 'x' } }))).toEqual([]);
    expect(await extensionFolders(tree({ 'README.md': 'x' }))).toEqual([]);
  });

  it('a package.json that is not JSON stops the release', async () => {
    await expect(extensionFolders(tree({ 'package.json': '{' }))).rejects.toThrow(/JSON/);
  });
});

describe('the CI copy', () => {
  it('writes the version and the releasing repo into package.json and the lock', async () => {
    const lock = { name: 'x', version: '0.0.0', packages: { '': { version: '0.0.0' } } };
    const root = tree({
      'extensions/probe/package.json': { ...ext('probe'), repository: 'github:agentage/old' },
      'extensions/probe/package-lock.json': lock,
    });
    const folder = { rel: 'extensions/probe', id: 'probe' };
    const written = await writeCiCopy(root, folder, '2026.1122.1', 'agentage/examples');
    expect(written).toEqual([
      'extensions/probe/package.json',
      'extensions/probe/package-lock.json',
    ]);
    const pkg = json(root, 'extensions/probe/package.json');
    expect(pkg['version']).toBe('2026.1122.1');
    expect(pkg['repository']).toEqual({
      type: 'git',
      url: 'git+https://github.com/agentage/examples.git',
      directory: 'extensions/probe',
    });
    const after = json(root, 'extensions/probe/package-lock.json');
    expect(after['version']).toBe('2026.1122.1');
    expect(after['packages']).toEqual({ '': { version: '2026.1122.1' } });
  });

  it('the root layout: no directory, a lock with no packages map, or no lock', async () => {
    const root = tree({ 'package.json': ext('root'), 'package-lock.json': { version: '0' } });
    const folder = { rel: '.', id: 'root' };
    expect(await writeCiCopy(root, folder, '2027.105.1', 'agentage/agentage.io')).toEqual([
      'package.json',
      'package-lock.json',
    ]);
    expect(json(root, 'package.json')['repository']).toEqual({
      type: 'git',
      url: 'git+https://github.com/agentage/agentage.io.git',
    });
    const bare = tree({ 'package.json': ext('root') });
    expect(await writeCiCopy(bare, folder, '2027.105.1', 'agentage/x')).toEqual(['package.json']);
  });
});
