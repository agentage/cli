import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { action, ActionError, type ActionDefinition } from '@agentage/core';
import { safeJoin } from '../../vaults/path-safety.js';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { ActionProgress } from './types.js';

export interface VaultReadInput {
  slug: string;
  path: string;
}

export interface VaultReadOutput {
  slug: string;
  path: string;
  content: string;
  size: number;
  mtime: number;
}

const validate = (raw: unknown): VaultReadInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['slug'] !== 'string' || r['slug'].length === 0)
    throw new Error('slug must be a non-empty string');
  if (typeof r['path'] !== 'string' || r['path'].length === 0)
    throw new Error('path must be a non-empty string');
  return { slug: r['slug'], path: r['path'] };
};

export const createVaultReadAction = (deps: {
  vaults: VaultRegistry;
}): ActionDefinition<VaultReadInput, VaultReadOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:read',
      version: '1.0',
      title: 'Read file from vault',
      description: 'Read the content of a vault-relative markdown file from disk',
      scope: 'machine',
      capability: 'vault.read',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultReadOutput, void> {
      const v = deps.vaults.get(input.slug);
      if (!v) {
        throw new ActionError('INVALID_INPUT', `vault "${input.slug}" does not exist`, false);
      }
      let fullPath: string;
      try {
        fullPath = safeJoin(v.config.path, input.path);
      } catch (err) {
        throw new ActionError(
          'INVALID_INPUT',
          err instanceof Error ? err.message : 'invalid path',
          false
        );
      }
      if (!existsSync(fullPath)) {
        throw new ActionError('INVALID_INPUT', `file not found: ${input.path}`, false);
      }
      const content = await readFile(fullPath, 'utf-8');
      const st = statSync(fullPath);
      return {
        slug: input.slug,
        path: input.path,
        content,
        size: st.size,
        mtime: st.mtimeMs,
      };
    },
  });
