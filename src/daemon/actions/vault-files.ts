import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { FileEntry } from '../../vaults/types.js';
import type { ActionProgress } from './types.js';

export interface VaultFilesInput {
  slug: string;
  prefix?: string;
  limit?: number;
  offset?: number;
}

export interface VaultFilesOutput {
  slug: string;
  files: FileEntry[];
}

const validate = (raw: unknown): VaultFilesInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['slug'] !== 'string' || r['slug'].length === 0)
    throw new Error('slug must be a non-empty string');
  const out: VaultFilesInput = { slug: r['slug'] };
  if (r['prefix'] !== undefined) {
    if (typeof r['prefix'] !== 'string') throw new Error('prefix must be a string');
    out.prefix = r['prefix'];
  }
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

export const createVaultFilesAction = (deps: {
  vaults: VaultRegistry;
}): ActionDefinition<VaultFilesInput, VaultFilesOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:files',
      version: '1.0',
      title: 'List files in vault',
      description: 'List markdown files in a vault, optionally filtered by path prefix',
      scope: 'machine',
      capability: 'vault.read',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultFilesOutput, void> {
      const v = deps.vaults.get(input.slug);
      if (!v) {
        throw new ActionError('INVALID_INPUT', `vault "${input.slug}" does not exist`, false);
      }
      const opts: { prefix?: string; limit?: number; offset?: number } = {};
      if (input.prefix !== undefined) opts.prefix = input.prefix;
      if (input.limit !== undefined) opts.limit = input.limit;
      if (input.offset !== undefined) opts.offset = input.offset;
      const files = await v.index.list(opts);
      return { slug: input.slug, files };
    },
  });
