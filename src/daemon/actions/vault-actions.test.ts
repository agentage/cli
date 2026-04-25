import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, type InvokeEvent } from '@agentage/core';
import { VaultRegistry } from '../../vaults/registry.js';
import { createVaultAddAction } from './vault-add.js';
import { createVaultListAction } from './vault-list.js';
import { createVaultReindexAction } from './vault-reindex.js';
import { createVaultRemoveAction } from './vault-remove.js';

const collect = async (gen: AsyncGenerator<InvokeEvent>): Promise<InvokeEvent[]> => {
  const events: InvokeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
};

describe('vault actions', () => {
  let storage: string;
  let vaultPath: string;
  let vaults: VaultRegistry;
  let persist: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'agentage-vactions-storage-'));
    vaultPath = await mkdtemp(join(tmpdir(), 'agentage-vactions-vault-'));
    vaults = new VaultRegistry({ storageDir: storage });
    persist = vi.fn<() => void>();
  });

  afterEach(async () => {
    await vaults.closeAll();
    await rm(storage, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  const buildRegistry = (): ReturnType<typeof createRegistry> => {
    const reg = createRegistry();
    reg.register(createVaultAddAction({ vaults, persist }));
    reg.register(createVaultRemoveAction({ vaults, persist }));
    reg.register(createVaultReindexAction({ vaults }));
    reg.register(createVaultListAction({ vaults }));
    return reg;
  };

  describe('vault:add', () => {
    it('registers vault, runs initial scan, persists config', async () => {
      await writeFile(join(vaultPath, 'a.md'), 'alpha');
      await writeFile(join(vaultPath, 'b.md'), 'beta');
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'notes' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({
        type: 'result',
        data: { slug: 'notes', fileCount: 2, path: vaultPath },
      });
      expect(vaults.has('notes')).toBe(true);
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('derives slug from path basename when not provided', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      const last = events.at(-1);
      expect(last).toMatchObject({ type: 'result' });
      const slug = (last as { data: { slug: string } }).data.slug;
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(vaults.has(slug)).toBe(true);
    });

    it('rejects nonexistent path', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: '/definitely/not/here', slug: 'x' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('rejects duplicate slug', async () => {
      const reg = buildRegistry();
      await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'dup' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      const events = await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'dup' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('rejects invalid slug shape', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'BadSlug!' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });

    it('requires vault.admin capability', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'x' },
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    });
  });

  describe('vault:remove', () => {
    it('removes registered vault and persists', async () => {
      const reg = buildRegistry();
      await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'gone' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      persist.mockClear();
      const events = await collect(
        reg.invoke({
          action: 'vault:remove',
          input: { slug: 'gone' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({
        type: 'result',
        data: { slug: 'gone', removed: true },
      });
      expect(vaults.has('gone')).toBe(false);
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('errors on unknown slug', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:remove',
          input: { slug: 'ghost' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });
  });

  describe('vault:reindex', () => {
    it('returns scan stats with new files counted as added', async () => {
      const reg = buildRegistry();
      await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'r' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      await writeFile(join(vaultPath, 'fresh.md'), 'just added');
      const events = await collect(
        reg.invoke({
          action: 'vault:reindex',
          input: { slug: 'r' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({
        type: 'result',
        data: { slug: 'r', added: 1, modified: 0, removed: 0 },
      });
    });

    it('errors on unknown slug', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:reindex',
          input: { slug: 'nope' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    });
  });

  describe('vault:list', () => {
    it('returns empty list when no vaults registered', async () => {
      const reg = buildRegistry();
      const events = await collect(
        reg.invoke({
          action: 'vault:list',
          input: {},
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      expect(events.at(-1)).toMatchObject({ type: 'result', data: { vaults: [] } });
    });

    it('returns metadata for each registered vault', async () => {
      await writeFile(join(vaultPath, 'a.md'), 'one');
      const reg = buildRegistry();
      await collect(
        reg.invoke({
          action: 'vault:add',
          input: { path: vaultPath, slug: 'mine' },
          callerId: 'test',
          capabilities: ['vault.admin'],
        })
      );
      const events = await collect(
        reg.invoke({
          action: 'vault:list',
          input: {},
          callerId: 'test',
          capabilities: ['vault.read'],
        })
      );
      const result = events.at(-1) as {
        data: { vaults: Array<{ slug: string; fileCount: number }> };
      };
      expect(result.data.vaults).toHaveLength(1);
      expect(result.data.vaults[0]?.slug).toBe('mine');
      expect(result.data.vaults[0]?.fileCount).toBe(1);
    });
  });
});
