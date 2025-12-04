#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { installCommand } from './commands/install.js';
import { listCommand } from './commands/list.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { publishCommand } from './commands/publish.js';
import { runCommand } from './commands/run.js';
import { searchCommand } from './commands/search.js';
import { updateCommand } from './commands/update.js';
import { whoamiCommand } from './commands/whoami.js';
import { version } from './index.js';
import { AuthError, getMe } from './services/auth.service.js';
import { loadConfig } from './utils/config.js';
import { checkForUpdates } from './utils/version.js';

const displayBanner = (): void => {
  console.log();
  console.log(
    chalk.cyan.bold('  ╔═══════════════════════════════════════════╗')
  );
  console.log(
    chalk.cyan.bold('  ║') +
      chalk.white.bold('         🤖 AgentKit CLI                   ') +
      chalk.cyan.bold('║')
  );
  console.log(
    chalk.cyan.bold('  ╚═══════════════════════════════════════════╝')
  );
  console.log();
};

const displayVersionInfo = async (): Promise<void> => {
  console.log(chalk.gray(`  Version: ${chalk.green.bold(version)}`));

  // Display login status
  try {
    const config = await loadConfig();
    if (config.auth?.token) {
      const user = await getMe();
      const displayName = user.name || user.email;
      const aliasDisplay = user.verifiedAlias
        ? chalk.gray(' (@') +
          chalk.green.bold(user.verifiedAlias) +
          chalk.gray(')')
        : '';
      console.log(
        chalk.gray('  Logged in as: ') +
          chalk.green.bold(displayName) +
          aliasDisplay
      );
    } else {
      console.log(
        chalk.gray('  Status: ') +
          chalk.yellow('Not logged in') +
          chalk.gray(' (run ') +
          chalk.cyan('agent login') +
          chalk.gray(')')
      );
    }
  } catch (error) {
    if (error instanceof AuthError && error.code === 'session_expired') {
      console.log(
        chalk.gray('  Status: ') +
          chalk.yellow('Session expired') +
          chalk.gray(' (run ') +
          chalk.cyan('agent login') +
          chalk.gray(')')
      );
    } else {
      console.log(
        chalk.gray('  Status: ') +
          chalk.yellow('Not logged in') +
          chalk.gray(' (run ') +
          chalk.cyan('agent login') +
          chalk.gray(')')
      );
    }
  }

  try {
    const result = await checkForUpdates(version);
    if (result.updateAvailable) {
      console.log();
      console.log(
        chalk.yellow.bold('  ⚠️  Update available: ') +
          chalk.red(version) +
          chalk.gray(' → ') +
          chalk.green.bold(result.latestVersion)
      );
      console.log(
        chalk.yellow('  Run ') +
          chalk.cyan.bold('agent update') +
          chalk.yellow(' to update to the latest version')
      );
    }
  } catch {
    // Silently ignore version check errors
  }
  console.log();
};

const displayCustomHelp = (): void => {
  console.log(
    chalk.white.bold('  Usage: ') +
      chalk.cyan('agent') +
      chalk.gray(' [command] [options]')
  );
  console.log();
  console.log(chalk.white.bold('  Commands:'));
  console.log();

  const commands = [
    { cmd: 'init', args: '[name]', desc: 'Initialize a new agent', icon: '🚀' },
    { cmd: 'run', args: '<name> [prompt]', desc: 'Run an agent', icon: '▶️ ' },
    { cmd: 'list', args: '', desc: 'List all agents', icon: '📋' },
    {
      cmd: 'publish',
      args: '[path]',
      desc: 'Publish agent to registry',
      icon: '📤',
    },
    {
      cmd: 'install',
      args: '<owner/name>',
      desc: 'Install agent from registry',
      icon: '📥',
    },
    {
      cmd: 'search',
      args: '<query>',
      desc: 'Search for agents',
      icon: '🔍',
    },
    {
      cmd: 'login',
      args: '',
      desc: 'Login to the Agentage registry',
      icon: '🔐',
    },
    {
      cmd: 'logout',
      args: '',
      desc: 'Logout from the Agentage registry',
      icon: '🚪',
    },
    {
      cmd: 'whoami',
      args: '',
      desc: 'Display the currently logged in user',
      icon: '👤',
    },
    {
      cmd: 'update',
      args: '',
      desc: 'Update the CLI to the latest version',
      icon: '⬆️ ',
    },
  ];

  for (const { cmd, args, desc, icon } of commands) {
    const cmdStr = chalk.cyan.bold(cmd.padEnd(10));
    const argsStr = chalk.gray(args.padEnd(16));
    console.log(`    ${icon} ${cmdStr} ${argsStr} ${chalk.white(desc)}`);
  }

  console.log();
  console.log(chalk.white.bold('  Options:'));
  console.log();
  console.log(
    `    ${chalk.cyan.bold('-v, --version')}   ${chalk.white(
      'Display version number'
    )}`
  );
  console.log(
    `    ${chalk.cyan.bold('-h, --help')}      ${chalk.white(
      'Display this help message'
    )}`
  );
  console.log();
  console.log(chalk.white.bold('  Examples:'));
  console.log();
  console.log(chalk.white('    $ ') + chalk.cyan('agent init my-agent'));
  console.log(
    chalk.white('    $ ') +
      chalk.cyan('agent run my-agent') +
      chalk.white(' "Hello, how are you?"')
  );
  console.log(chalk.white('    $ ') + chalk.cyan('agent list'));
  console.log();
};

const program = new Command();

program
  .name('agent')
  .description('CLI tool for creating and running AI agents locally')
  .version(version, '-v, --version', 'Display version number')
  .configureHelp({
    formatHelp: () => '', // Suppress default help
  })
  .helpOption('-h, --help', 'Display this help message')
  .action(() => {
    // When running just "agent" or "agent --help"
    displayBanner();
    displayVersionInfo().then(() => {
      displayCustomHelp();
    });
  });

program
  .command('init')
  .description('Initialize a new agent')
  .argument('[name]', 'Agent name')
  .option('-g, --global', 'Initialize in global directory (~/.agentage)')
  .action(initCommand);

program
  .command('run')
  .description('Run an agent')
  .argument('<name>', 'Agent name')
  .argument('[prompt]', 'Prompt to send to the agent')
  .action(runCommand);

program.command('list').description('List all agents').action(listCommand);

// Registry commands
program
  .command('publish')
  .description('Publish agent to registry')
  .argument('[path]', 'Path to agent file')
  .option(
    '-v, --visibility <visibility>',
    'Visibility (public or private)',
    'public'
  )
  .option('--version <version>', 'Override version')
  .option('-t, --tag <tag...>', 'Add tags')
  .option('-c, --changelog <message>', 'Changelog message')
  .option('--dry-run', 'Validate without publishing')
  .action(publishCommand);

program
  .command('install')
  .description('Install agent from registry')
  .argument('<name>', 'Agent name (owner/name[@version])')
  .option('-g, --global', 'Install to global location')
  .option('-l, --local', 'Install to local project')
  .option('-f, --force', 'Overwrite existing')
  .action(installCommand);

program
  .command('search')
  .description('Search for agents in registry')
  .argument('<query>', 'Search query')
  .option('-n, --limit <number>', 'Number of results', '10')
  .option('-p, --page <number>', 'Page number', '1')
  .option('--json', 'Output as JSON')
  .action(searchCommand);

// Auth commands
program
  .command('login')
  .description('Login to the Agentage registry')
  .action(loginCommand);

program
  .command('logout')
  .description('Logout from the Agentage registry')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Display the currently logged in user')
  .action(whoamiCommand);

program
  .command('update')
  .description('Update the CLI to the latest version')
  .action(updateCommand);

// Handle help flag explicitly
if (process.argv.includes('-h') || process.argv.includes('--help')) {
  if (process.argv.length === 3) {
    // Just "agent --help" or "agent -h"
    displayBanner();
    displayVersionInfo().then(() => {
      displayCustomHelp();
    });
  } else {
    program.parse();
  }
} else if (process.argv.length === 2) {
  // Just "agent" with no args
  displayBanner();
  displayVersionInfo().then(() => {
    displayCustomHelp();
  });
} else {
  program.parse();
}
