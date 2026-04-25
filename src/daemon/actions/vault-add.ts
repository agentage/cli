import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import type { VaultScope, VaultWriteMode } from '../../vaults/types.js';
import type { ActionProgress } from './types.js';

export interface VaultAddInput {
  path: string;
  slug?: string;
  scope?: VaultScope;
  writeMode?: VaultWriteMode;
}

export interface VaultAddOutput {
  slug: string;
  uuid: string;
  path: string;
  fileCount: number;
}

const VALID_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SCOPES: ReadonlySet<string> = new Set(['local', 'shared']);
const WRITE_MODES: ReadonlySet<string> = new Set(['inbox-dated', 'append-daily']);

const validate = (raw: unknown): VaultAddInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['path'] !== 'string' || r['path'].length === 0)
    throw new Error('path must be a non-empty string');
  const out: VaultAddInput = { path: r['path'] };
  if (r['slug'] !== undefined) {
    if (typeof r['slug'] !== 'string' || !VALID_SLUG.test(r['slug']))
      throw new Error('slug must match /^[a-z0-9][a-z0-9-]*$/');
    out.slug = r['slug'];
  }
  if (r['scope'] !== undefined) {
    if (typeof r['scope'] !== 'string' || !SCOPES.has(r['scope']))
      throw new Error('scope must be "local" or "shared"');
    out.scope = r['scope'] as VaultScope;
  }
  if (r['writeMode'] !== undefined) {
    if (typeof r['writeMode'] !== 'string' || !WRITE_MODES.has(r['writeMode']))
      throw new Error('writeMode must be "inbox-dated" or "append-daily"');
    out.writeMode = r['writeMode'] as VaultWriteMode;
  }
  return out;
};

const deriveSlug = (absPath: string): string => {
  const base = basename(absPath);
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const createVaultAddAction = (deps: {
  vaults: VaultRegistry;
  persist: () => void;
}): ActionDefinition<VaultAddInput, VaultAddOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:add',
      version: '1.0',
      title: 'Add vault',
      description: 'Register a new vault and run the initial index scan',
      scope: 'machine',
      capability: 'vault.admin',
      idempotent: false,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultAddOutput, void> {
      const absPath = resolve(input.path);
      if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
        throw new ActionError('INVALID_INPUT', `path is not a directory: ${absPath}`, false);
      }
      const slug = input.slug ?? deriveSlug(absPath);
      if (!VALID_SLUG.test(slug)) {
        throw new ActionError(
          'INVALID_INPUT',
          `derived slug "${slug}" is invalid; pass slug explicitly`,
          false
        );
      }
      if (deps.vaults.has(slug)) {
        throw new ActionError('INVALID_INPUT', `vault "${slug}" already exists`, false);
      }
      yield { step: 'register', detail: `slug=${slug}` };

      const { entry, stats } = await deps.vaults.add({
        slug,
        path: absPath,
        scope: input.scope,
        writeMode: input.writeMode,
      });

      yield { step: 'persist', detail: 'writing config' };
      deps.persist();

      return {
        slug: entry.slug,
        uuid: entry.config.uuid,
        path: entry.config.path,
        fileCount: stats.added,
      };
    },
  });
