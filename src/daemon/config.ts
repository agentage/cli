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
    /**
     * Host interface the daemon binds to. Defaults to '127.0.0.1'
     * (loopback only — no LAN/network access). Set to '0.0.0.0' to
     * expose to all interfaces (e.g. for tailscale, LAN testing).
     * The daemon has no auth on its action endpoints, so non-loopback
     * binding is opt-in.
     */
    bindHost?: string;
  };
  hub?: {
    url: string;
  };
  agents: DirConfig;
  projects: DirConfig;
  vaults?: Record<string, VaultConfig>;
  /**
   * Parent directory holding multiple vaults (one subdirectory = one vault).
   * Default `~/projects/vaults`. Set during `agentage setup --vaults-dir`
   * or by editing config.json. Env var AGENTAGE_DEFAULT_VAULTS_DIR
   * overrides at runtime. Hub heartbeat ships this value as `vaultsDefault`
   * so the dashboard knows where the user keeps vaults.
   */
  vaultsDefault?: string;
  sync: {
    events: SyncEvents;
  };
}

export const DEFAULT_BIND_HOST = '127.0.0.1';

export const getBindHost = (config: DaemonConfig): string =>
  config.daemon.bindHost ?? DEFAULT_BIND_HOST;

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

/**
 * Resolve the parent directory holding the user's vaults, with this priority:
 *   1. AGENTAGE_DEFAULT_VAULTS_DIR (env, runtime override)
 *   2. config.vaultsDefault (persistent, set by `agentage setup --vaults-dir`)
 *   3. ~/projects/vaults (built-in default)
 *
 * Each subdirectory under this path is treated as one vault during
 * `agentage setup` auto-registration.
 */
export const getDefaultVaultsDir = (config?: DaemonConfig): string =>
  process.env['AGENTAGE_DEFAULT_VAULTS_DIR'] ||
  config?.vaultsDefault ||
  join(homedir(), 'projects', 'vaults');

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

const isDirConfig = (value: unknown): value is DirConfig => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { default?: unknown; additional?: unknown };
  return (
    typeof v.default === 'string' &&
    Array.isArray(v.additional) &&
    v.additional.every((d) => typeof d === 'string')
  );
};

const isValidConfigShape = (value: unknown): value is Partial<DaemonConfig> => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<DaemonConfig>;
  // daemon.port must be a number
  if (typeof v.daemon !== 'object' || v.daemon === null || typeof v.daemon.port !== 'number') {
    return false;
  }
  if (!isDirConfig(v.agents)) return false;
  if (!isDirConfig(v.projects)) return false;
  if (typeof v.sync !== 'object' || v.sync === null) return false;
  return true;
};

/**
 * Migrate legacy `discovery.dirs` (singular config from cli@<0.18) into the
 * current `agents.default` / `projects.default` shape. The old format
 * carried a flat list of directories; we keep them as `agents.additional`
 * so users don't lose their custom search paths after upgrading.
 */
const tryMigrateLegacyDiscovery = (raw: unknown): Partial<DaemonConfig> | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const v = raw as { discovery?: { dirs?: unknown } };
  if (!v.discovery || !Array.isArray(v.discovery.dirs)) return undefined;
  const dirs = v.discovery.dirs.filter((d): d is string => typeof d === 'string');
  if (dirs.length === 0) return undefined;
  return {
    agents: { default: getDefaultAgentsDir(), additional: dirs },
    projects: { default: getDefaultProjectsDir(), additional: [] },
  };
};

export const loadConfig = (): DaemonConfig => {
  const configPath = join(getConfigDir(), 'config.json');

  let rawConfig: unknown;
  if (existsSync(configPath)) {
    try {
      rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      // Malformed JSON — treat as missing; we'll regenerate below.
      rawConfig = undefined;
    }
  }

  const legacyMachine =
    typeof rawConfig === 'object' && rawConfig !== null
      ? (rawConfig as Partial<DaemonConfig>).machine
      : undefined;
  const machine = resolveMachine(legacyMachine);

  // Foreign schema (e.g. cli@<0.18 `discovery.dirs`, desktop-era files,
  // partial writes) — migrate if we recognise it, otherwise rewrite from
  // defaults. Either way, the on-disk file ends up valid and the daemon
  // never spreads an underspecified object into a `DaemonConfig`.
  let config: DaemonConfig;
  if (rawConfig !== undefined && isValidConfigShape(rawConfig)) {
    config = { ...(rawConfig as DaemonConfig), machine };
  } else {
    const migrated = tryMigrateLegacyDiscovery(rawConfig);
    config = migrated
      ? { ...createDefaultConfig(machine), ...migrated, machine }
      : createDefaultConfig(machine);
    saveConfig(config);
  }

  if (!existsSync(configPath)) {
    saveConfig(config);
  }

  const portOverride = process.env['AGENTAGE_PORT'];
  if (portOverride) {
    config.daemon.port = parseInt(portOverride, 10);
  }

  const bindHostOverride = process.env['AGENTAGE_BIND_HOST'];
  if (bindHostOverride) {
    config.daemon.bindHost = bindHostOverride;
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
