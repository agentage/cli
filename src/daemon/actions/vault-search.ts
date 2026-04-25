import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { Hit } from '../../vaults/types.js';
import type { ActionProgress } from './types.js';

export interface VaultSearchInput {
  slug: string;
  query: string;
  limit?: number;
  offset?: number;
}

export interface VaultSearchOutput {
  slug: string;
  query: string;
  hits: Hit[];
}

const validate = (raw: unknown): VaultSearchInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['slug'] !== 'string' || r['slug'].length === 0)
    throw new Error('slug must be a non-empty string');
  if (typeof r['query'] !== 'string' || r['query'].length === 0)
    throw new Error('query must be a non-empty string');
  const out: VaultSearchInput = { slug: r['slug'], query: r['query'] };
  if (r['limit'] !== undefined) {
    if (typeof r['limit'] !== 'number' || !Number.isInteger(r['limit']) || r['limit'] < 1)
      throw new Error('limit must be a positive integer');
    out.limit = r['limit'];
  }
  if (r['offset'] !== undefined) {
    if (typeof r['offset'] !== 'number' || !Number.isInteger(r['offset']) || r['offset'] < 0)
      throw new Error('offset must be a non-negative integer');
    out.offset = r['offset'];
  }
  return out;
};

export const createVaultSearchAction = (deps: {
  vaults: VaultRegistry;
}): ActionDefinition<VaultSearchInput, VaultSearchOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:search',
      version: '1.0',
      title: 'Search vault',
      description:
        'Full-text search the vault index using SQLite FTS5; returns ranked hits with snippets',
      scope: 'machine',
      capability: 'vault.read',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultSearchOutput, void> {
      const v = deps.vaults.get(input.slug);
      if (!v) {
        throw new ActionError('INVALID_INPUT', `vault "${input.slug}" does not exist`, false);
      }
      const opts: { limit?: number; offset?: number } = {};
      if (input.limit !== undefined) opts.limit = input.limit;
      if (input.offset !== undefined) opts.offset = input.offset;
      const hits = await v.index.search(input.query, opts);
      return { slug: input.slug, query: input.query, hits };
    },
  });
