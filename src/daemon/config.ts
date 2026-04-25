import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { VaultConfig } from '../vaults/types.js';

export interface SyncEvents {
  state: boolean;
  result: boolean;
  error: boolean;
  input_required: boolean;
  'output.llm.delta': boolean;
  'output.llm.tool_call': boolean;
  'output.llm.usage': boolean;
  'output.progress': boolean;
}

export interface DirConfig {
  default: string;
  additional: string[];
}

export interface MachineIdentity {
  id: string;
  name: string;
}

export interface DaemonConfig {
  machine: MachineIdentity;
  daemon: {
    port: number;
  };
  hub?: {
    url: string;
  };
  agents: DirConfig;
  projects: DirConfig;
  vaults?: Record<string, VaultConfig>;
  sync: {
    events: SyncEvents;
  };
}

export const getVaultStorageDir = (): string => join(getConfigDir(), 'vaults');

export const getConfigDir = (): string => {
  const dir = process.env['AGENTAGE_CONFIG_DIR'] || join(process.env['HOME'] || '~', '.agentage');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const getDefaultAgentsDir = (): string => join(homedir(), 'agents');
export const getDefaultProjectsDir = (): string => join(homedir(), 'projects');

export const getAgentsDirs = (config: DaemonConfig): string[] => {
  const all = [config.agents.default, ...config.agents.additional];
  return Array.from(new Set(all));
};

export const getProjectsDirs = (config: DaemonConfig): string[] => {
  const all = [config.projects.default, ...config.projects.additional];
  return Array.from(new Set(all));
};

const getMachinePath = (): string => join(getConfigDir(), 'machine.json');

const readMachineFile = (): MachineIdentity | undefined => {
  const path = getMachinePath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<MachineIdentity>;
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // fall through
  }
  return undefined;
};

const writeMachineFile = (machine: MachineIdentity): void => {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(getMachinePath(), JSON.stringify(machine, null, 2) + '\n', 'utf-8');
};

/**
 * Resolve machine identity with this priority:
 *   1. machine.json (authoritative — survives config.json regen)
 *   2. legacy config.json `machine` block (migrated into machine.json)
 *   3. freshly minted identity (UUID + hostname)
 */
const resolveMachine = (fromLegacyConfig: MachineIdentity | undefined): MachineIdentity => {
  const fromFile = readMachineFile();
  if (fromFile) return fromFile;

  const adopted = fromLegacyConfig ?? { id: randomUUID(), name: hostname() };
  writeMachineFile(adopted);
  return adopted;
};

const createDefaultConfig = (machine: MachineIdentity): DaemonConfig => ({
  machine,
  daemon: {
    port: 4243,
  },
  agents: {
    default: getDefaultAgentsDir(),
    additional: [],
  },
  projects: {
    default: getDefaultProjectsDir(),
    additional: [],
  },
  vaults: {},
  sync: {
    events: {
      state: true,
      result: true,
      error: true,
      input_required: true,
      'output.llm.delta': true,
      'output.llm.tool_call': true,
      'output.llm.usage': true,
      'output.progress': true,
    },
  },
});

export const loadConfig = (): DaemonConfig => {
  const configPath = join(getConfigDir(), 'config.json');

  let rawConfig: Partial<DaemonConfig> | undefined;
  if (existsSync(configPath)) {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<DaemonConfig>;
  }

  const machine = resolveMachine(rawConfig?.machine);

  const config: DaemonConfig = rawConfig
    ? ({ ...rawConfig, machine } as DaemonConfig)
    : createDefaultConfig(machine);

  if (!existsSync(configPath)) {
    saveConfig(config);
  }

  const portOverride = process.env['AGENTAGE_PORT'];
  if (portOverride) {
    config.daemon.port = parseInt(portOverride, 10);
  }

  const agentsOverride = process.env['AGENTAGE_AGENTS_DIR'];
  if (agentsOverride) {
    config.agents.default = agentsOverride;
  }

  const projectsOverride = process.env['AGENTAGE_PROJECTS_DIR'];
  if (projectsOverride) {
    config.projects.default = projectsOverride;
  }

  return config;
};

export const saveConfig = (config: DaemonConfig): void => {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeMachineFile(config.machine);
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
};
