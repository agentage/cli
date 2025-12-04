import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';
import { agentYamlSchema } from '../schemas/agent.schema.js';

export const runCommand = async (
  name: string,
  prompt?: string
): Promise<void> => {
  try {
    const agentsDir = 'agents';
    const filename = join(agentsDir, `${name}.yml`);
    const content = await readFile(filename, 'utf-8');
    const yaml = parse(content);

    const validated = agentYamlSchema.parse(yaml);

    const userPrompt = prompt || 'Hello!';
    console.log(`\n🤖 Running ${validated.name}...\n`);
    console.log(chalk.gray(`Model: ${validated.model}`));
    console.log(chalk.gray(`Prompt: ${userPrompt}`));
    console.log();

    // Note: The run command requires an AI provider integration.
    // This is a placeholder that shows the agent would be run.
    // TODO: Add support for direct OpenAI/Claude API calls or integrate a runtime.
    console.log(
      chalk.yellow(
        '⚠️  Agent runtime not available. This is a standalone CLI without SDK integration.'
      )
    );
    console.log(
      chalk.gray(
        'To run agents, integrate with an AI provider (OpenAI, Anthropic, etc.) directly.'
      )
    );
    console.log();
  } catch (error) {
    console.error(`❌ Failed: ${(error as Error).message}`);
    process.exit(1);
  }
};
