import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';

const TEMPLATES: Record<string, { content: (name: string) => string; deps?: string[] }> = {
  simple: {
    content: (name) => `import { agent, output } from '@agentage/core';

export default agent({
  name: '${name}',
  description: 'A simple agent',
  async *run({ task }) {
    yield output(\`Running: \${task}\`);
  },
});
`,
  },
  shell: {
    content: (name) => `import { agent, shell } from '@agentage/core';

export default agent({
  name: '${name}',
  description: 'Executes a shell command and streams output',
  async *run({ task }) {
    yield* shell(task);
  },
});
`,
  },
  claude: {
    deps: ['@anthropic-ai/claude-agent-sdk'],
    content: (name) => `import { agent, claude } from '@agentage/core';

export default agent({
  name: '${name}',
  description: 'Runs a task using Claude Code',
  async *run({ task }, { signal }) {
    yield* claude(task, {
      signal,
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
      maxTurns: 10,
    });
  },
});
`,
  },
  copilot: {
    deps: ['@github/copilot-sdk'],
    content: (name) => `import { agent, copilot } from '@agentage/core';

export default agent({
  name: '${name}',
  description: 'Runs a task using GitHub Copilot',
  async *run({ task }, { signal }) {
    yield* copilot(task, { signal, model: 'gpt-4o' });
  },
});
`,
  },
  llm: {
    content: (name) => `import { agent } from '@agentage/core';

export default agent({
  name: '${name}',
  description: 'An LLM-powered agent',
  model: 'claude-sonnet-4-6',
  tools: ['read', 'glob', 'grep'],
  prompt: \`You are a helpful assistant.
Respond concisely and cite sources when possible.\`,
});
`,
  },
};

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const createCreateCommand = (): Command => {
  const cmd = new Command('create')
    .description('Scaffold a new agent from a template')
    .argument('<name>', 'Agent name (kebab-case)')
    .option('-t, --template <template>', 'Template: simple, shell, claude, copilot, llm', 'simple')
    .option('-d, --dir <dir>', 'Output directory', '.')
    .action(async (name: string, options: { template: string; dir: string }) => {
      if (!KEBAB_CASE.test(name)) {
        console.error(chalk.red(`Invalid name "${name}". Use kebab-case (e.g. my-agent).`));
        process.exitCode = 1;
        return;
      }

      const template = TEMPLATES[options.template];
      if (!template) {
        console.error(
          chalk.red(
            `Unknown template "${options.template}". Available: ${Object.keys(TEMPLATES).join(', ')}`
          )
        );
        process.exitCode = 1;
        return;
      }

      const dir = resolve(options.dir);
      const filePath = join(dir, `${name}.agent.ts`);

      if (existsSync(filePath)) {
        console.error(chalk.red(`File already exists: ${filePath}`));
        process.exitCode = 1;
        return;
      }

      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, template.content(name));
      console.log(chalk.green(`Created ${filePath}`));

      if (template.deps?.length) {
        console.log(
          chalk.yellow(`\nInstall dependencies:\n  npm install ${template.deps.join(' ')}`)
        );
      }

      console.log(
        chalk.dim(`\nTo use:\n  cp ${filePath} ~/.agentage/agents/\n  agentage agents --refresh`)
      );
    });

  return cmd;
};
