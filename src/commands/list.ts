import chalk from 'chalk';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';
import { agentYamlSchema } from '../schemas/agent.schema.js';
import { AgentConfig } from './init.js';

interface AgentInfo {
  name: string;
  model: string;
  location: 'global' | 'local';
  path: string;
  error?: string;
}

/**
 * Get global agents directory (~/.agentage/agents)
 */
const getGlobalAgentsDir = (): string => join(homedir(), '.agentage', 'agents');

/**
 * Load local agent.json config from current directory
 */
const loadLocalAgentConfig = async (): Promise<AgentConfig | null> => {
  try {
    const configPath = 'agent.json';
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as AgentConfig;
  } catch {
    return null;
  }
};

/**
 * Load global agent.json config from ~/.agentage
 */
const loadGlobalAgentConfig = async (): Promise<AgentConfig | null> => {
  try {
    const configPath = join(homedir(), '.agentage', 'agent.json');
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as AgentConfig;
  } catch {
    return null;
  }
};

/**
 * Get agent paths from config or use defaults
 */
const getAgentPaths = async (
  config: AgentConfig | null,
  defaultPath: string
): Promise<string[]> => {
  if (config?.paths && config.paths.length > 0) {
    return config.paths.filter((p) => existsSync(p));
  }
  return existsSync(defaultPath) ? [defaultPath] : [];
};

/**
 * Scan a directory for agent files (.yml and .agent.md)
 */
const scanAgentsInDir = async (
  dir: string,
  location: 'global' | 'local'
): Promise<AgentInfo[]> => {
  const agents: AgentInfo[] = [];

  try {
    const files = await readdir(dir);
    const agentFiles = files.filter(
      (f) => f.endsWith('.yml') || f.endsWith('.agent.md')
    );

    for (const file of agentFiles) {
      const filePath = join(dir, file);
      try {
        const content = await readFile(filePath, 'utf-8');

        if (file.endsWith('.agent.md')) {
          // Parse frontmatter from .agent.md files
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const frontmatter = parse(frontmatterMatch[1]);
            agents.push({
              name: frontmatter.name || file.replace('.agent.md', ''),
              model: frontmatter.model || 'default',
              location,
              path: filePath,
            });
          } else {
            agents.push({
              name: file.replace('.agent.md', ''),
              model: 'unknown',
              location,
              path: filePath,
              error: 'Missing frontmatter',
            });
          }
        } else {
          // Parse .yml files
          const yaml = parse(content);
          const validated = agentYamlSchema.parse(yaml);
          agents.push({
            name: validated.name,
            model: validated.model,
            location,
            path: filePath,
          });
        }
      } catch (error) {
        const name = file.replace('.yml', '').replace('.agent.md', '');
        agents.push({
          name,
          model: 'unknown',
          location,
          path: filePath,
          error: error instanceof Error ? error.message : 'Invalid format',
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return agents;
};

export const listCommand = async (): Promise<void> => {
  try {
    const allAgents: AgentInfo[] = [];

    // 1. Load global agents
    const globalConfig = await loadGlobalAgentConfig();
    const globalDefaultDir = getGlobalAgentsDir();
    const globalPaths = await getAgentPaths(globalConfig, globalDefaultDir);

    for (const path of globalPaths) {
      const agents = await scanAgentsInDir(path, 'global');
      allAgents.push(...agents);
    }

    // 2. Load local agents
    const localConfig = await loadLocalAgentConfig();
    const localDefaultDir = 'agents';
    const localPaths = await getAgentPaths(localConfig, localDefaultDir);

    for (const path of localPaths) {
      const agents = await scanAgentsInDir(path, 'local');
      allAgents.push(...agents);
    }

    // 3. Display results
    if (allAgents.length === 0) {
      console.log(
        'No agents found. Run ' + chalk.cyan('agent init') + ' to create one.'
      );
      return;
    }

    const globalAgents = allAgents.filter((a) => a.location === 'global');
    const localAgents = allAgents.filter((a) => a.location === 'local');

    console.log('\n📋 Available Agents:\n');

    if (globalAgents.length > 0) {
      console.log('  🌍 Global:');
      for (const agent of globalAgents) {
        if (agent.error) {
          console.log(`    ❌ ${agent.name} - ${agent.error}`);
        } else {
          console.log(`    ✅ ${agent.name} (${agent.model})`);
        }
      }
      console.log();
    }

    if (localAgents.length > 0) {
      console.log('  📁 Local:');
      for (const agent of localAgents) {
        if (agent.error) {
          console.log(`    ❌ ${agent.name} - ${agent.error}`);
        } else {
          console.log(`    ✅ ${agent.name} (${agent.model})`);
        }
      }
      console.log();
    }
  } catch (error) {
    console.error(`❌ Failed: ${(error as Error).message}`);
  }
};
