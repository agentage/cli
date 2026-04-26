import { action, ActionError, type ActionDefinition } from '@agentage/core';
import { loadConfig, saveConfig, type DaemonConfig } from '../config.js';
import type { ActionProgress } from './types.js';

// settings:update — applies a partial diff to the daemon's persisted config.
// Three fields are exposed for now (matching what the dashboard's Settings
// form edits): agents_default, projects_default, vaults_default. All
// optional; only the keys present in `input` are written. The on-disk
// config.json is rewritten atomically by saveConfig.
//
// Powers the editable Settings form on /machines/:id once γ ships. See
// work/tasks/daemon-command-bridge for the bridge end-to-end design.

export interface SettingsUpdateInput {
  agents_default?: string;
  projects_default?: string;
  vaults_default?: string;
}

export interface SettingsUpdateOutput {
  // Echo the values that ended up persisted, so the dashboard can render
  // confirmation copy without re-fetching.
  agents_default: string;
  projects_default: string;
  vaults_default: string | null;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const validate = (raw: unknown): SettingsUpdateInput => {
  if (!raw || typeof raw !== 'object') throw new Error('input must be an object');
  const r = raw as Record<string, unknown>;
  const out: SettingsUpdateInput = {};
  if (r['agents_default'] !== undefined) {
    if (!isNonEmptyString(r['agents_default'])) {
      throw new Error('agents_default must be a non-empty string');
    }
    out.agents_default = r['agents_default'];
  }
  if (r['projects_default'] !== undefined) {
    if (!isNonEmptyString(r['projects_default'])) {
      throw new Error('projects_default must be a non-empty string');
    }
    out.projects_default = r['projects_default'];
  }
  if (r['vaults_default'] !== undefined) {
    if (!isNonEmptyString(r['vaults_default'])) {
      throw new Error('vaults_default must be a non-empty string');
    }
    out.vaults_default = r['vaults_default'];
  }
  if (Object.keys(out).length === 0) {
    throw new Error(
      'input must include at least one of: agents_default, projects_default, vaults_default'
    );
  }
  return out;
};

export interface SettingsUpdateDeps {
  // Indirection via deps lets tests stub the on-disk read/write without
  // touching the actual ~/.agentage/config.json on the test runner.
  loadConfig?: () => DaemonConfig;
  saveConfig?: (cfg: DaemonConfig) => void;
}

export const createSettingsUpdateAction = (
  deps: SettingsUpdateDeps = {}
): ActionDefinition<SettingsUpdateInput, SettingsUpdateOutput, ActionProgress> =>
  action({
    manifest: {
      name: 'settings:update',
      version: '1.0',
      title: 'Update daemon settings',
      description:
        'Apply a partial diff to the daemon-side default paths (agents, projects, vaults).',
      scope: 'machine',
      capability: 'config.write',
      idempotent: true,
    },
    validateInput: validate,
    async *execute(_ctx, input): AsyncGenerator<ActionProgress, SettingsUpdateOutput, void> {
      const read = deps.loadConfig ?? loadConfig;
      const write = deps.saveConfig ?? saveConfig;

      yield { step: 'read', detail: 'loading current daemon config' };
      let config: DaemonConfig;
      try {
        config = read();
      } catch (err) {
        throw new ActionError(
          'EXECUTION_FAILED',
          `Failed to load daemon config: ${err instanceof Error ? err.message : String(err)}`,
          true
        );
      }

      // Build the updated config — preserve everything else; only write the
      // keys present in the input.
      const next: DaemonConfig = {
        ...config,
        agents: {
          ...config.agents,
          default: input.agents_default ?? config.agents.default,
        },
        projects: {
          ...config.projects,
          default: input.projects_default ?? config.projects.default,
        },
        vaultsDefault: input.vaults_default ?? config.vaultsDefault,
      };

      yield { step: 'write', detail: 'persisting config.json' };
      try {
        write(next);
      } catch (err) {
        throw new ActionError(
          'EXECUTION_FAILED',
          `Failed to persist daemon config: ${err instanceof Error ? err.message : String(err)}`,
          true
        );
      }

      return {
        agents_default: next.agents.default,
        projects_default: next.projects.default,
        vaults_default: next.vaultsDefault ?? null,
      };
    },
  });
