import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { reconcileVault, type ReconcileStats } from './reconciler.js';
import { SqliteFts5Index } from './sqlite-fts5-index.js';
import type {
  VaultConfig,
  VaultIndex,
  VaultMetadata,
  VaultScope,
  VaultWriteMode,
} from './types.js';

export interface VaultRegistryOptions {
  storageDir: string;
  indexFactory?: (path: string) => VaultIndex;
}

export interface VaultEntry {
  slug: string;
  config: VaultConfig;
  index: VaultIndex;
}

export class VaultRegistry {
  private vaults = new Map<string, VaultEntry>();
  private storageDir: string;
  private indexFactory: (path: string) => VaultIndex;

  constructor(opts: VaultRegistryOptions) {
    this.storageDir = opts.storageDir;
    this.indexFactory = opts.indexFactory ?? ((path) => new SqliteFts5Index(path));
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  hydrate(vaults: Record<string, VaultConfig>): void {
    for (const [slug, config] of Object.entries(vaults)) {
      if (this.vaults.has(slug)) continue;
      const index = this.indexFactory(this.indexPath(config.uuid));
      this.vaults.set(slug, { slug, config, index });
    }
  }

  has(slug: string): boolean {
    return this.vaults.has(slug);
  }

  get(slug: string): VaultEntry | undefined {
    return this.vaults.get(slug);
  }

  list(): VaultEntry[] {
    return Array.from(this.vaults.values());
  }

  async metadata(): Promise<VaultMetadata[]> {
    return Promise.all(
      this.list().map(async (v) => ({
        slug: v.slug,
        uuid: v.config.uuid,
        path: v.config.path,
        fileCount: await v.index.fileCount(),
        indexedAt: await v.index.indexedAt(),
      }))
    );
  }

  async add(input: {
    slug: string;
    path: string;
    scope?: VaultScope;
    writeMode?: VaultWriteMode;
  }): Promise<{ entry: VaultEntry; stats: ReconcileStats }> {
    if (this.vaults.has(input.slug)) {
      throw new Error(`vault "${input.slug}" already exists`);
    }
    const config: VaultConfig = {
      uuid: randomUUID(),
      path: input.path,
      scope: input.scope ?? 'local',
      writeMode: input.writeMode ?? 'inbox-dated',
    };
    const index = this.indexFactory(this.indexPath(config.uuid));
    const entry: VaultEntry = { slug: input.slug, config, index };
    this.vaults.set(input.slug, entry);
    const stats = await reconcileVault(config.path, index);
    return { entry, stats };
  }

  async remove(slug: string): Promise<void> {
    const v = this.vaults.get(slug);
    if (!v) throw new Error(`vault "${slug}" does not exist`);
    await v.index.close();
    this.vaults.delete(slug);
    const path = this.indexPath(v.config.uuid);
    await rm(path, { force: true });
    await rm(`${path}-shm`, { force: true });
    await rm(`${path}-wal`, { force: true });
  }

  async reindex(slug: string): Promise<ReconcileStats> {
    const v = this.vaults.get(slug);
    if (!v) throw new Error(`vault "${slug}" does not exist`);
    return reconcileVault(v.config.path, v.index);
  }

  toConfigShape(): Record<string, VaultConfig> {
    const out: Record<string, VaultConfig> = {};
    for (const v of this.vaults.values()) {
      out[v.slug] = v.config;
    }
    return out;
  }

  async closeAll(): Promise<void> {
    for (const v of this.vaults.values()) {
      await v.index.close();
    }
    this.vaults.clear();
  }

  private indexPath(uuid: string): string {
    return join(this.storageDir, `${uuid}.db`);
  }
}
