import { mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const sampleAgentTemplate = `---
name: {{name}}
description: An AI assistant agent
argument-hint: Describe what you want help with
tools: []
handoffs: []
---
You are a helpful AI assistant.

Respond clearly and concisely to user requests.
`;

export interface AgentConfig {
  paths: string[];
}

export interface InitOptions {
  global?: boolean;
}

/**
 * Get global agentage directory (~/.agentage)
 */
const getGlobalDir = (): string => join(homedir(), '.agentage');

export const initCommand = async (
  name?: string,
  options?: InitOptions
): Promise<void> => {
  const agentName = name || 'my-agent';
  const isGlobal = options?.global ?? false;

  // Determine base directory
  const baseDir = isGlobal ? getGlobalDir() : '.';
  const agentsDir = join(baseDir, 'agents');
  const agentFilePath = join(agentsDir, `${agentName}.agent.md`);
  const configFilePath = join(baseDir, 'agent.json');

  const agentContent = sampleAgentTemplate.replace(/{{name}}/g, agentName);

  const agentConfig: AgentConfig = {
    paths: ['agents/'],
  };

  try {
    // Create agents directory if it doesn't exist
    await mkdir(agentsDir, { recursive: true });

    // Create agent.md file based on sample.agent.md template
    await writeFile(agentFilePath, agentContent, 'utf-8');
    console.log(`✅ Created ${agentFilePath}`);

    // Create agent.json config file
    await writeFile(
      configFilePath,
      JSON.stringify(agentConfig, null, 2),
      'utf-8'
    );
    console.log(`✅ Created ${configFilePath}`);
  } catch (error) {
    console.error(`❌ Failed: ${(error as Error).message}`);
    process.exit(1);
  }
};
