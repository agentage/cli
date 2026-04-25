import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultRegistry } from './registry.js';

describe('VaultRegistry', () => {
  let storage: string;
  let vaultPath: string;
  let registry: VaultRegistry;

  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'agentage-vaultreg-'));
    vaultPath = await mkdtemp(join(tmpdir(), 'agentage-vaultcontent-'));
    registry = new VaultRegistry({ storageDir: storage });
  });

  afterEach(async () => {
    await registry.closeAll();
    await rm(storage, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('starts empty', () => {
    expect(registry.list()).toEqual([]);
    expect(registry.has('anything')).toBe(false);
  });

  it('add creates index, scans files, registers slug', async () => {
    await writeFile(join(vaultPath, 'one.md'), 'first note');
    await writeFile(join(vaultPath, 'two.md'), 'second note');
    const { entry, stats } = await registry.add({ slug: 'notes', path: vaultPath });
    expect(stats).toEqual({ added: 2, modified: 0, removed: 0, unchanged: 0 });
    expect(entry.slug).toBe('notes');
    expect(entry.config.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.config.scope).toBe('local');
    expect(entry.config.writeMode).toBe('inbox-dated');
    expect(registry.has('notes')).toBe(true);
    expect(await entry.index.fileCount()).toBe(2);
  });

  it('add rejects duplicate slug', async () => {
    await registry.add({ slug: 'notes', path: vaultPath });
    await expect(registry.add({ slug: 'notes', path: vaultPath })).rejects.toThrow(
      /already exists/
    );
  });

  it('metadata returns slug/uuid/path/fileCount/indexedAt for each vault', async () => {
    await writeFile(join(vaultPath, 'a.md'), 'one');
    await registry.add({ slug: 'notes', path: vaultPath });
    const meta = await registry.metadata();
    expect(meta).toHaveLength(1);
    expect(meta[0]?.slug).toBe('notes');
    expect(meta[0]?.fileCount).toBe(1);
    expect(meta[0]?.indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('remove drops vault from registry and deletes index file', async () => {
    await writeFile(join(vaultPath, 'a.md'), 'x');
    const { entry } = await registry.add({ slug: 'notes', path: vaultPath });
    const indexFile = join(storage, `${entry.config.uuid}.db`);
    await registry.remove('notes');
    expect(registry.has('notes')).toBe(false);
    const { existsSync } = await import('node:fs');
    expect(existsSync(indexFile)).toBe(false);
  });

  it('remove rejects unknown slug', async () => {
    await expect(registry.remove('ghost')).rejects.toThrow(/does not exist/);
  });

  it('reindex picks up filesystem changes', async () => {
    await writeFile(join(vaultPath, 'a.md'), 'first');
    await registry.add({ slug: 'notes', path: vaultPath });
    await writeFile(join(vaultPath, 'b.md'), 'second');
    const stats = await registry.reindex('notes');
    expect(stats.added).toBe(1);
    const v = registry.get('notes');
    expect(await v?.index.fileCount()).toBe(2);
  });

  it('hydrate restores existing vaults from config shape', async () => {
    await writeFile(join(vaultPath, 'a.md'), 'persisted');
    const { entry } = await registry.add({ slug: 'notes', path: vaultPath });
    const shape = registry.toConfigShape();
    await registry.closeAll();

    const fresh = new VaultRegistry({ storageDir: storage });
    fresh.hydrate(shape);
    expect(fresh.has('notes')).toBe(true);
    const v = fresh.get('notes');
    expect(v?.config.uuid).toBe(entry.config.uuid);
    expect(await v?.index.fileCount()).toBe(1);
    await fresh.closeAll();
  });

  it('toConfigShape reflects current registered vaults', async () => {
    await registry.add({ slug: 'a', path: vaultPath });
    const second = await mkdtemp(join(tmpdir(), 'agentage-vaultcontent-b-'));
    try {
      await registry.add({ slug: 'b', path: second });
      const shape = registry.toConfigShape();
      expect(Object.keys(shape).sort()).toEqual(['a', 'b']);
      expect(shape['a']?.path).toBe(vaultPath);
      expect(shape['b']?.path).toBe(second);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  });
});
