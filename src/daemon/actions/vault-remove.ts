import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { ActionProgress } from './types.js';

export interface VaultRemoveInput {
  slug: string;
}

export interface VaultRemoveOutput {
  slug: string;
  removed: true;
}

const validate = (raw: unknown): VaultRemoveInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['slug'] !== 'string' || r['slug'].length === 0)
    throw new Error('slug must be a non-empty string');
  return { slug: r['slug'] };
};

export const createVaultRemoveAction = (deps: {
  vaults: VaultRegistry;
  persist: () => void;
}): ActionDefinition<VaultRemoveInput, VaultRemoveOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:remove',
      version: '1.0',
      title: 'Remove vault',
      description: 'Unregister a vault and delete its index (does not touch user files)',
      scope: 'machine',
      capability: 'vault.admin',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultRemoveOutput, void> {
      if (!deps.vaults.has(input.slug)) {
        throw new ActionError('INVALID_INPUT', `vault "${input.slug}" does not exist`, false);
      }
      yield { step: 'remove', detail: `slug=${input.slug}` };
      await deps.vaults.remove(input.slug);
      deps.persist();
      return { slug: input.slug, removed: true };
    },
  });
