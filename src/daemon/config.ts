import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
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
  discovery: {
    dirs: string[];
  };
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

const createDefaultConfig = (): DaemonConfig => {
  const configDir = getConfigDir();
  return {
    machine: {
      id: randomUUID(),
      name: hostname(),
    },
    daemon: {
      port: 4243,
    },
    discovery: {
      dirs: [join(configDir, 'agents'), join(configDir, 'skills')],
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
  };
};

export const loadConfig = (): DaemonConfig => {
  const configPath = join(getConfigDir(), 'config.json');

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as DaemonConfig;
  }

  const config = createDefaultConfig();
  saveConfig(config);
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
