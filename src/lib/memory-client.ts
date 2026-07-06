import { expandHome, indexDbPath } from './vault-registry.js';
import { openIndex, type Hit, type VaultIndex } from './vault-index.js';
import { reconcileIndex } from './vault-scan.js';
import {
  deleteDoc,
  editDoc,
  readDoc,
  writeDoc,
  type DocView,
  type WriteReceipt,
} from './vault-store.js';
import { type EditOp } from './memory-edit.js';
import { type VaultsConfig, type VaultType } from './vaults.schema.js';

// The one seam every index-touching verb goes through (daemon-index-ownership V10). This is
// the DirectClient (in-process) impl; the DaemonClient lands with the daemon (M2.5). Verbs
// never touch SQLite or the store directly - they call these six methods.

const MAX_SYNCED_DOC = 8 * 1024 * 1024; // ADR-011 WI-4: 8 MB per-doc cap on account vaults
const READ_MAX = 1_000_000; // bounded read output
const SEARCH_LIMIT_MAX = 100; // bounded search page

export interface SearchOutput {
  vault: string;
  results: Hit[];
}
export interface ListOutput {
  vault: string;
  folder: string;
  entries: { path: string; updated: string }[];
}
export interface DeleteOutput {
  vault: string;
  path: string;
  trashedTo: string;
}
export type ReadOutput = DocView & { vault: string; truncated: boolean };

export interface VerbOptions {
  vault?: string;
  folder?: string;
  limit?: number;
}

export interface MemoryClient {
  search(query: string, opts?: VerbOptions): Promise<SearchOutput>;
  read(ref: string, opts?: VerbOptions): Promise<ReadOutput>;
  write(
    ref: string,
    body: string,
    opts?: VerbOptions & { frontmatter?: Record<string, unknown> }
  ): Promise<WriteReceipt & { vault: string }>;
  edit(
    ref: string,
    op: Omit<EditOp, 'path'>,
    opts?: VerbOptions
  ): Promise<WriteReceipt & { vault: string }>;
  list(folder: string | undefined, opts?: VerbOptions): Promise<ListOutput>;
  delete(ref: string, opts?: VerbOptions): Promise<DeleteOutput>;
}

interface Resolved {
  name: string;
  path: string;
  type: VaultType;
  relPath: string;
}

const parseRef = (ref: string): { vaultName?: string; relPath: string } => {
  const m = /^@([A-Za-z0-9_-]{1,64})\/(.+)$/.exec(ref);
  return m ? { vaultName: m[1]!, relPath: m[2]! } : { relPath: ref };
};

export const createDirectClient = (config: VaultsConfig): MemoryClient => {
  const resolve = (ref: string, vaultOpt?: string): Resolved => {
    const { vaultName, relPath } = parseRef(ref);
    const want = vaultName ?? vaultOpt;
    const vaults = config.vaults;
    if (vaults.length === 0) throw new Error('no vaults registered - run `agentage vault add`');
    const vault = want
      ? vaults.find((v) => v.name === want)
      : vaults.length === 1
        ? vaults[0]
        : undefined;
    if (!vault)
      throw new Error(
        want ? `unknown vault: ${want}` : 'multiple vaults - use --vault <name> or @<vault>/<path>'
      );
    return { name: vault.name, path: expandHome(vault.path), type: vault.type, relPath };
  };

  // A folder-only ref (no doc path) resolves the vault without requiring a relPath.
  const resolveVault = (vaultOpt?: string): Omit<Resolved, 'relPath'> => {
    const r = resolve('_', vaultOpt);
    return { name: r.name, path: r.path, type: r.type };
  };

  const refreshed = async <T>(
    v: Omit<Resolved, 'relPath'>,
    use: (i: VaultIndex) => T
  ): Promise<T> => {
    const index = openIndex(indexDbPath(v.name));
    try {
      await reconcileIndex(index, v.path);
      return use(index);
    } finally {
      index.close();
    }
  };

  const capForSync = (v: Resolved, body: string): void => {
    if (v.type === 'couchdb' && Buffer.byteLength(body, 'utf-8') > MAX_SYNCED_DOC)
      throw new Error(`document exceeds the 8 MB limit for account-synced vaults`);
  };

  return {
    async search(query, opts = {}) {
      const v = resolveVault(opts.vault);
      const limit = Math.min(opts.limit ?? 20, SEARCH_LIMIT_MAX);
      const results = await refreshed(v, (i) => i.search(query, { limit }));
      return { vault: v.name, results };
    },

    async read(ref, opts = {}) {
      const v = resolve(ref, opts.vault);
      const doc = await readDoc(v.path, v.relPath);
      const truncated = doc.body.length > READ_MAX;
      return {
        ...doc,
        vault: v.name,
        truncated,
        body: truncated ? doc.body.slice(0, READ_MAX) : doc.body,
      };
    },

    async write(ref, body, opts = {}) {
      const v = resolve(ref, opts.vault);
      capForSync(v, body);
      const receipt = await writeDoc(v.path, v.relPath, body, opts.frontmatter);
      await refreshed(v, () => undefined);
      return { ...receipt, vault: v.name };
    },

    async edit(ref, op, opts = {}) {
      const v = resolve(ref, opts.vault);
      const receipt = await editDoc(v.path, { ...op, path: v.relPath });
      await refreshed(v, () => undefined);
      return { ...receipt, vault: v.name };
    },

    async list(folder, opts = {}) {
      const v = resolveVault(opts.vault);
      const prefix =
        folder && folder.length > 0 ? (folder.endsWith('/') ? folder : `${folder}/`) : undefined;
      const entries = await refreshed(v, (i) =>
        i.list(prefix ? { prefix } : {}).map((e) => ({
          path: e.path,
          updated: new Date(e.mtime).toISOString(),
        }))
      );
      return { vault: v.name, folder: folder ?? '', entries };
    },

    async delete(ref, opts = {}) {
      const v = resolve(ref, opts.vault);
      const { trashedTo } = await deleteDoc(v.path, v.relPath);
      await refreshed(v, () => undefined);
      return { vault: v.name, path: v.relPath, trashedTo };
    },
  };
};
