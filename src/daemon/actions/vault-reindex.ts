import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { ActionProgress } from './types.js';

export interface VaultReindexInput {
  slug: string;
}

export interface VaultReindexOutput {
  slug: string;
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
}

const validate = (raw: unknown): VaultReindexInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['slug'] !== 'string' || r['slug'].length === 0)
    throw new Error('slug must be a non-empty string');
  return { slug: r['slug'] };
};

export const createVaultReindexAction = (deps: {
  vaults: VaultRegistry;
}): ActionDefinition<VaultReindexInput, VaultReindexOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:reindex',
      version: '1.0',
      title: 'Reindex vault',
      description: 'Force a full filesystem rescan of the vault',
      scope: 'machine',
      capability: 'vault.admin',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultReindexOutput, void> {
      if (!deps.vaults.has(input.slug)) {
        throw new ActionError('INVALID_INPUT', `vault "${input.slug}" does not exist`, false);
      }
      yield { step: 'scan', detail: `slug=${input.slug}` };
      const stats = await deps.vaults.reindex(input.slug);
      return { slug: input.slug, ...stats };
    },
  });
