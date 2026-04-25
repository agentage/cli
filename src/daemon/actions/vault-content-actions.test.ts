import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, type InvokeEvent } from '@agentage/core';
import { VaultRegistry } from '../../vaults/registry.js';
import { createVaultEditAction } from './vault-edit.js';
import { createVaultFilesAction } from './vault-files.js';
import { createVaultReadAction } from './vault-read.js';
import { createVaultSearchAction } from './vault-search.js';

const collect = async (gen: AsyncGenerator<InvokeEvent>): Promise<InvokeEvent[]> => {
  const events: InvokeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
};

describe('vault content actions', () => {
  let storage: string;
  let vaultPath: string;
  let vaults: VaultRegistry;

  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'agentage-vcontent-storage-'));
    vaultPath = await mkdtemp(join(tmpdir(), 'agentage-vcontent-vault-'));
    vaults = new VaultRegistry({ storageDir: storage });
    await writeFile(join(vaultPath, 'a.md'), 'apple banana cherry');
    await writeFile(join(vaultPath, 'b.md'), 'banana date elderberry');
    await vaults.add({ slug: 'fruits', path: vaultPath });
  });

  afterEach(async () => {
    await vaults.closeAll();
    await rm(storage, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  const buildRegistry = (): ReturnType<typeof createRegistry> => {
    const reg = createRegistry();
    reg.register(createVaultFilesAction({ vaults }));
    reg.register(createVaultReadAction({ vaults }));
    reg.register(createVaultSearchAction({ vaults }));
    reg.register(createVaultEditAction({ vaults }));
    return reg;
  };

  describe('vault:files', () => {
    it('lists every markdown file in the vault', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:files',
          input: { slug: 'fruits' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const last = events.at(-1) as { data: { files: Array<{ path: string }> } };
      expect(last.data.files.map((f) => f.path).sort()).toEqual(['a.md', 'b.md']);
    });

    it('filters by prefix', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:files',
          input: { slug: 'fruits', prefix: 'a' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const last = events.at(-1) as { data: { files: Array<{ path: string }> } };
      expect(last.data.files.map((f) => f.path)).toEqual(['a.md']);
    });

    it('errors on unknown vault', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:files',
          input: { slug: 'nope' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('requires vault.read capability', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:files',
          input: { slug: 'fruits' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    });
  });

  describe('vault:read', () => {
    it('returns the content of a vault-relative file', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:read',
          input: { slug: 'fruits', path: 'a.md' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({
        type: 'result',
        data: { slug: 'fruits', path: 'a.md', content: 'apple banana cherry' },
      });
    });

    it('errors when file does not exist', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:read',
          input: { slug: 'fruits', path: 'missing.md' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('rejects path-traversal attempts', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:read',
          input: { slug: 'fruits', path: '../../etc/passwd' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('rejects absolute paths', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:read',
          input: { slug: 'fruits', path: '/etc/passwd' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });
  });

  describe('vault:search', () => {
    it('returns ranked hits with snippets', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:search',
          input: { slug: 'fruits', query: 'banana' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const last = events.at(-1) as { data: { hits: Array<{ path: string; snippet: string }> } };
      expect(last.data.hits.length).toBe(2);
      expect(last.data.hits[0]?.snippet).toContain('<<banana>>');
    });

    it('returns empty hits when no match', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:search',
          input: { slug: 'fruits', query: 'tractor' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const last = events.at(-1) as { data: { hits: Array<unknown> } };
      expect(last.data.hits).toEqual([]);
    });

    it('rejects empty query', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:search',
          input: { slug: 'fruits', query: '' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('respects limit', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:search',
          input: { slug: 'fruits', query: 'banana', limit: 1 },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const last = events.at(-1) as { data: { hits: Array<unknown> } };
      expect(last.data.hits.length).toBe(1);
    });
  });

  describe('vault:edit', () => {
    it('writes inbox-dated by default and indexes the new file', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'a fresh note' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      const last = events.at(-1) as {
        data: { slug: string; path: string; mode: string; bytesWritten: number };
      };
      expect(last.data.mode).toBe('inbox-dated');
      expect(last.data.path).toMatch(/^inbox\//);
      expect(last.data.bytesWritten).toBe(12);

      const onDisk = await readFile(join(vaultPath, last.data.path), 'utf-8');
      expect(onDisk).toBe('a fresh note');

      const v = vaults.get('fruits');
      expect(await v?.index.fileCount()).toBe(3);
    });

    it('append-daily creates and appends the daily file', async () => {
      const reg = buildRegistry();
      await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'first', mode: 'append-daily' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      const events2 = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'second', mode: 'append-daily' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      const last = events2.at(-1) as { data: { path: string } };
      expect(last.data.path).toMatch(/^daily\/\d{4}-\d{2}-\d{2}\.md$/);
      const onDisk = await readFile(join(vaultPath, last.data.path), 'utf-8');
      expect(onDisk).toContain('first');
      expect(onDisk).toContain('second');
    });

    it('overwrite mode writes to the explicit path', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: {
            slug: 'fruits',
            content: 'replaced contents',
            mode: 'overwrite',
            path: 'a.md',
          },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'result', data: { path: 'a.md' } });
      const onDisk = await readFile(join(vaultPath, 'a.md'), 'utf-8');
      expect(onDisk).toBe('replaced contents');
    });

    it('overwrite mode rejects missing path', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'x', mode: 'overwrite' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('overwrite mode rejects path-traversal', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: {
            slug: 'fruits',
            content: 'x',
            mode: 'overwrite',
            path: '../../etc/passwd',
          },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('requires vault.write capability', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'x' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    });

    it('rejects unknown vault', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'ghost', content: 'x' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('rejects invalid mode', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'x', mode: 'destroy' as 'overwrite' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('newly written file is searchable immediately', async () => {
      const reg = buildRegistry();
      await collect(
        reg.invoke({
          action: 'vault:edit',
          input: { slug: 'fruits', content: 'pomegranate is unique' },
          callerId: 'test',
          capabilities: ['vault.write'],
        })
      );
      const events = await collect(
        reg.invoke({
          action: 'vault:search',
          input: { slug: 'fruits', query: 'pomegranate' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const last = events.at(-1) as { data: { hits: Array<{ path: string }> } };
      expect(last.data.hits.length).toBe(1);
      expect(last.data.hits[0]?.path).toMatch(/^inbox\//);
    });
  });
});
