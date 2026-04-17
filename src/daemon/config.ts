import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

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

export interface DaemonConfig {
  machine: {
    id: string;
    name: string;
  };
  daemon: {
    port: number;
  };
  hub?: {
    url: string;
  };
  agents: DirConfig;
  projects: DirConfig;
  sync: {
    events: SyncEvents;
  };
}

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

const createDefaultConfig = (): DaemonConfig => ({
  machine: {
    id: randomUUID(),
    name: hostname(),
  },
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

  let config: DaemonConfig;

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw) as DaemonConfig;
  } else {
    config = createDefaultConfig();
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
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
};
