import { action, ActionError, type ActionDefinition } from '@agentage/core';
import type { VaultRegistry } from '../../vaults/registry.js';
import { writeToVault, type EditMode } from '../../vaults/writer.js';
import type { ActionProgress } from './types.js';

export interface VaultEditInput {
  slug: string;
  content: string;
  mode?: EditMode;
  path?: string;
}

export interface VaultEditOutput {
  slug: string;
  path: string;
  mode: EditMode;
  bytesWritten: number;
}

const VALID_MODES: ReadonlySet<string> = new Set(['inbox-dated', 'append-daily', 'overwrite']);

const validate = (raw: unknown): VaultEditInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['slug'] !== 'string' || r['slug'].length === 0)
    throw new Error('slug must be a non-empty string');
  if (typeof r['content'] !== 'string') throw new Error('content must be a string');
  const out: VaultEditInput = { slug: r['slug'], content: r['content'] };
  if (r['mode'] !== undefined) {
    if (typeof r['mode'] !== 'string' || !VALID_MODES.has(r['mode']))
      throw new Error('mode must be inbox-dated, append-daily, or overwrite');
    out.mode = r['mode'] as EditMode;
  }
  if (r['path'] !== undefined) {
    if (typeof r['path'] !== 'string') throw new Error('path must be a string');
    out.path = r['path'];
  }
  return out;
};

export const createVaultEditAction = (deps: {
  vaults: VaultRegistry;
}): ActionDefinition<VaultEditInput, VaultEditOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'vault:edit',
      version: '1.0',
      title: 'Write content to vault',
      description:
        "Append or create a markdown file. Default mode is the vault's configured writeMode (typically inbox-dated, which creates a new file in inbox/ — never modifies existing notes)",
      scope: 'machine',
      capability: 'vault.write',
      idempotent: false,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, VaultEditOutput, void> {
      const v = deps.vaults.get(input.slug);
      if (!v) {
        throw new ActionError('INVALID_INPUT', `vault "${input.slug}" does not exist`, false);
      }
      const mode: EditMode = input.mode ?? v.config.writeMode;
      if (mode === 'overwrite' && (!input.path || input.path.length === 0)) {
        throw new ActionError('INVALID_INPUT', 'overwrite mode requires path', false);
      }
      yield { step: 'write', detail: `mode=${mode}` };
      let result;
      try {
        result = await writeToVault(v.config.path, input.content, mode, input.path);
      } catch (err) {
        throw new ActionError(
          'INVALID_INPUT',
          err instanceof Error ? err.message : 'write failed',
          false
        );
      }
      yield { step: 'index', detail: `path=${result.relPath}` };
      await v.index.reconcile({
        added: [result.change],
        modified: [],
        removed: [],
      });
      return {
        slug: input.slug,
        path: result.relPath,
        mode: result.mode,
        bytesWritten: result.bytesWritten,
      };
    },
  });
