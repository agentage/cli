import {
  createRegistry,
  createRouter,
  type EditInput,
  type ListResult,
  type MemoryView,
  type Router,
  type SearchResult,
  type VaultsConfig,
  type WriteResult,
} from '@agentage/memory-core';

// The one seam every memory verb goes through. This is the DirectClient (in-process) impl over
// @agentage/memory-core: per-vault git-backed local backends behind a federation router. Verbs
// delegate to the router; result shapes are memory-core's contract types at full fidelity.

export interface DeleteResult {
  path: string;
  deleted: boolean;
}

export interface VerbOptions {
  vault?: string;
}

export interface SearchOptions extends VerbOptions {
  folder?: string;
  limit?: number;
  tags?: string[];
  cursor?: string;
}

export interface ListOptions extends VerbOptions {
  depth?: 1 | 2;
  tags?: string[];
}

export interface MemoryClient {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>;
  read(ref: string, opts?: VerbOptions): Promise<MemoryView>;
  write(
    ref: string,
    body: string,
    opts?: VerbOptions & { frontmatter?: Record<string, unknown> }
  ): Promise<WriteResult>;
  edit(ref: string, op: Omit<EditInput, 'path'>, opts?: VerbOptions): Promise<WriteResult>;
  list(folder: string | undefined, opts?: ListOptions): Promise<ListResult>;
  delete(ref: string, opts?: VerbOptions): Promise<DeleteResult>;
}

interface Context {
  router: Router;
  multi: boolean;
  hasDefault: boolean;
}

// --vault becomes an @-prefix so the router resolves it; an explicit @<vault>/... passes through.
const scopeRef = (ref: string, vault?: string): string =>
  ref.startsWith('@') ? ref : vault ? `@${vault}/${ref}` : ref;

const scopeFolder = (folder?: string, vault?: string): string | undefined => {
  if (vault) return folder ? `@${vault}/${folder}` : `@${vault}`;
  return folder || undefined;
};

export const createDirectClient = (config: VaultsConfig): MemoryClient => {
  let ctxP: Promise<Context> | undefined;
  const ctx = (): Promise<Context> => {
    if (!ctxP) {
      ctxP = (async () => {
        const registry = await createRegistry(config);
        // Offline engine: only local (git working-copy) backends are usable here.
        const local = registry.list().filter((h) => h.backend.capabilities().kind === 'local');
        if (local.length === 0)
          throw new Error('no local vaults registered - run `agentage vault add <name> --local`');
        const def = registry.default();
        const defaultHandle = def && local.some((h) => h.id === def.id) ? def : undefined;
        return {
          router: createRouter(local, defaultHandle),
          multi: local.length > 1,
          hasDefault: !!defaultHandle,
        };
      })();
      ctxP.catch(() => (ctxP = undefined));
    }
    return ctxP;
  };

  // A single-target verb on a bare ref needs a vault when >1 is registered and none is default.
  const requireTarget = (ref: string, c: Context): void => {
    if (c.multi && !c.hasDefault && !ref.startsWith('@'))
      throw new Error(
        'multiple vaults - use --vault <name>, @<vault>/<path>, or set "default" in vaults.json'
      );
  };

  return {
    async search(query, opts = {}) {
      const { router } = await ctx();
      return router.search({
        query,
        folder: scopeFolder(opts.folder, opts.vault),
        tags: opts.tags,
        limit: opts.limit,
        cursor: opts.cursor,
      });
    },

    async read(ref, opts = {}) {
      const c = await ctx();
      const target = scopeRef(ref, opts.vault);
      requireTarget(target, c);
      const view = await c.router.read(target);
      if (!view) throw new Error(`not found: ${ref}`);
      return view;
    },

    async write(ref, body, opts = {}) {
      const c = await ctx();
      const target = scopeRef(ref, opts.vault);
      requireTarget(target, c);
      return c.router.write({ path: target, body, frontmatter: opts.frontmatter });
    },

    async edit(ref, op, opts = {}) {
      const c = await ctx();
      const target = scopeRef(ref, opts.vault);
      requireTarget(target, c);
      const receipt = await c.router.edit({ ...op, path: target });
      if (!receipt) throw new Error(`not found: ${ref}`);
      return receipt;
    },

    async list(folder, opts = {}) {
      const { router } = await ctx();
      return router.list({
        folder: scopeFolder(folder, opts.vault),
        depth: opts.depth,
        tags: opts.tags,
      });
    },

    async delete(ref, opts = {}) {
      const c = await ctx();
      const target = scopeRef(ref, opts.vault);
      requireTarget(target, c);
      const deleted = await c.router.delete(target);
      if (!deleted) throw new Error(`not found: ${ref}`);
      return { path: target, deleted };
    },
  };
};
