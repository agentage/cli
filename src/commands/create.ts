import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';

const TEMPLATES: Record<string, { content: (name: string) => string; deps?: string[] }> = {
  simple: {
    content: (name) => `import { createAgent } from '@agentage/core';

export const agent = createAgent({
  name: '${name}',
  description: 'A simple agent',
  path: '',
  async *run(input, { signal }) {
    yield {
      type: 'output',
      data: { type: 'output', content: \`Running: \${input.task}\`, format: 'text' },
      timestamp: Date.now(),
    };

    yield {
      type: 'result',
      data: { type: 'result', success: true, output: 'Done' },
      timestamp: Date.now(),
    };
  },
});

export default agent;
`,
  },
  shell: {
    content: (name) => `import { createAgent, type RunEvent } from '@agentage/core';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const agent = createAgent({
  name: '${name}',
  description: 'Executes a shell command and streams output',
  path: '',
  async *run(input, { signal }) {
    const events: RunEvent[] = [];
    let exitCode: number | null = null;

    await new Promise<void>((resolve) => {
      const proc = spawn(input.task, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
      signal.addEventListener('abort', () => proc.kill(), { once: true });

      if (proc.stdout) {
        const rl = createInterface({ input: proc.stdout });
        rl.on('line', (line) => {
          events.push({ type: 'output', data: { type: 'output', content: line, format: 'text' }, timestamp: Date.now() });
        });
      }

      proc.on('close', (code) => { exitCode = code; resolve(); });
      proc.on('error', () => resolve());
    });

    for (const event of events) yield event;

    yield {
      type: 'result',
      data: { type: 'result', success: exitCode === 0, output: exitCode === 0 ? 'Done' : \`Exited with code \${exitCode}\` },
      timestamp: Date.now(),
    };
  },
});

export default agent;
`,
  },
  claude: {
    deps: ['@anthropic-ai/claude-agent-sdk'],
    content: (name) => `import { createAgent } from '@agentage/core';
import { query } from '@anthropic-ai/claude-agent-sdk';

export const agent = createAgent({
  name: '${name}',
  description: 'Runs a task using Claude Code',
  path: '',
  async *run(input, { signal }) {
    if (!process.env['ANTHROPIC_API_KEY']) {
      yield { type: 'error', data: { type: 'error', code: 'MISSING_API_KEY', message: 'ANTHROPIC_API_KEY not set', recoverable: false }, timestamp: Date.now() };
      yield { type: 'result', data: { type: 'result', success: false, output: 'ANTHROPIC_API_KEY not set' }, timestamp: Date.now() };
      return;
    }

    const controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort(), { once: true });

    for await (const message of query({
      prompt: input.task,
      options: { allowedTools: ['Read', 'Glob', 'Grep', 'Bash'], abortController: controller, maxTurns: 10 },
    })) {
      if (message.type === 'result') {
        yield { type: 'result', data: { type: 'result', success: message.subtype === 'success' }, timestamp: Date.now() };
      }
    }
  },
});

export default agent;
`,
  },
  copilot: {
    deps: ['@github/copilot-sdk'],
    content: (name) => `import { createAgent } from '@agentage/core';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

export const agent = createAgent({
  name: '${name}',
  description: 'Runs a task using GitHub Copilot',
  path: '',
  async *run(input, { signal }) {
    const client = new CopilotClient();
    try {
      await client.start();
      const session = await client.createSession({ model: 'gpt-4o', onPermissionRequest: approveAll });
      signal.addEventListener('abort', () => session.abort(), { once: true });

      const idle = new Promise<void>((resolve) => { session.on('session.idle', () => resolve()); });
      await session.send({ prompt: input.task });
      await idle;

      yield { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() };
      await session.disconnect();
    } finally {
      await client.stop().catch(() => {});
    }
  },
});

export default agent;
`,
  },
};

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const createCreateCommand = (): Command => {
  const cmd = new Command('create')
    .description('Scaffold a new agent from a template')
    .argument('<name>', 'Agent name (kebab-case)')
    .option('-t, --template <template>', 'Template: simple, shell, claude, copilot', 'simple')
    .option('-d, --dir <dir>', 'Output directory', '.')
    .action(async (name: string, options: { template: string; dir: string }) => {
      if (!KEBAB_CASE.test(name)) {
        console.error(
          chalk.red(`Invalid name "${name}". Use kebab-case (e.g. my-agent).`)
        );
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
        chalk.dim(
          `\nTo use:\n  cp ${filePath} ~/.agentage/agents/\n  agentage agents --refresh`
        )
      );
    });

  return cmd;
};
