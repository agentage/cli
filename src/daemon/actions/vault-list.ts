import { action, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { VaultMetadata } from '../../vaults/types.js';
import type { ActionProgress } from './types.js';

export type VaultListInput = Record<string, never>;

export interface VaultListOutput {
  vaults: VaultMetadata[];
}

const validate = (_raw: unknown): VaultListInput => ({});

export const createVaultListAction = (deps: {
  vaults: VaultRegistry;
}): ActionDefinition<VaultListInput, VaultListOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:list',
      version: '1.0',
      title: 'List vaults',
      description: 'Return metadata for every registered vault',
      scope: 'machine',
      capability: 'vault.read',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(): AsyncGenerator<ActionProgress, VaultListOutput, void> {
      const vaults = await deps.vaults.metadata();
      return { vaults };
    },
  });
