import chalk from 'chalk';
import { existsSync } from 'fs';
import { access, mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import {
  getAgent,
  getAgentVersion,
  RegistryApiError,
} from '../services/registry.service.js';
import { parseAgentIdentifier } from '../utils/agent-parser.js';

interface InstallOptions {
  global?: boolean;
  local?: boolean;
  force?: boolean;
}

/**
 * Determine where to install the agent
 */
const getInstallDir = async (options: InstallOptions): Promise<string> => {
  if (options.global) {
    return join(homedir(), '.agentage', 'agents');
  }

  if (options.local) {
    return 'agents';
  }

  // Default: check if in a project (has agent.json)
  if (existsSync('agent.json')) {
    return 'agents';
  }

  return join(homedir(), '.agentage', 'agents');
};

/**
 * Install command - install agent from registry
 */
export const installCommand = async (
  identifier: string,
  options: InstallOptions = {}
): Promise<void> => {
  try {
    // 1. Parse identifier: owner/name[@version]
    const { owner, name, version } = parseAgentIdentifier(identifier);

    if (!owner || !name) {
      console.error(chalk.red('❌ Invalid format.'));
      console.log(
        'Use:',
        chalk.cyan('agent install owner/name'),
        'or',
        chalk.cyan('agent install owner/name@version')
      );
      process.exit(1);
    }

    const versionLabel = version ? `@${version}` : '';
    console.log(chalk.cyan(`📥 Installing ${owner}/${name}${versionLabel}...`));

    // 2. Fetch agent
    let content: string;
    let installedVersion: string;

    if (version) {
      const versionData = await getAgentVersion(owner, name, version);
      if (!versionData.content) {
        console.error(chalk.red('❌ Version content not available.'));
        process.exit(1);
      }
      content = versionData.content;
      installedVersion = version;
    } else {
      const agent = await getAgent(owner, name);
      content = agent.latestContent;
      installedVersion = agent.latestVersion;
    }

    // 3. Determine install location
    const installDir = await getInstallDir(options);
    const fileName = `${name}.agent.md`;
    const filePath = join(installDir, fileName);

    // 4. Check if exists
    if (!options.force) {
      let fileExists = false;
      try {
        await access(filePath);
        fileExists = true;
      } catch {
        // File doesn't exist, good
      }

      if (fileExists) {
        console.error(chalk.red(`❌ Agent already exists at ${filePath}`));
        console.log(chalk.gray('   Use --force to overwrite.'));
        process.exit(1);
      }
    }

    // 5. Write file
    await mkdir(installDir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    // 6. Success
    console.log();
    console.log(
      chalk.green(`✅ Installed ${owner}/${name}@${installedVersion}`)
    );
    console.log(chalk.gray(`   Location: ${filePath}`));
    console.log(chalk.gray(`   Run with: agent run ${name}`));
    console.log();
  } catch (error) {
    if (error instanceof RegistryApiError) {
      if (error.statusCode === 404) {
        console.error(chalk.red(`❌ Agent not found: ${identifier}`));
      } else if (error.statusCode === 403) {
        console.error(
          chalk.red('❌ Access denied. This agent may be private.')
        );
        console.log('Run', chalk.cyan('agent login'), 'to authenticate.');
      } else {
        console.error(chalk.red(`❌ ${error.message}`));
      }
    } else {
      console.error(chalk.red(`❌ Failed: ${(error as Error).message}`));
    }
    process.exit(1);
  }
};
