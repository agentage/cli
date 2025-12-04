import chalk from 'chalk';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import {
  publishAgent,
  RegistryApiError,
} from '../services/registry.service.js';
import {
  generateDateVersion,
  isValidAgentName,
  readAgentFile,
} from '../utils/agent-parser.js';
import { getAuthStatus } from '../utils/config.js';

interface PublishOptions {
  visibility?: 'public' | 'private';
  version?: string;
  tag?: string[];
  changelog?: string;
  dryRun?: boolean;
}

/**
 * Find agent file to publish
 */
const resolveAgentPath = async (pathArg?: string): Promise<string | null> => {
  // If path specified, use it
  if (pathArg) {
    if (existsSync(pathArg)) {
      return pathArg;
    }
    // Try adding .agent.md extension
    const withExt = pathArg.endsWith('.agent.md')
      ? pathArg
      : `${pathArg}.agent.md`;
    if (existsSync(withExt)) {
      return withExt;
    }
    // Try in agents directory
    const inAgentsDir = join('agents', withExt);
    if (existsSync(inAgentsDir)) {
      return inAgentsDir;
    }
    return null;
  }

  // Look for .agent.md files in current directory
  const currentDirFiles = await readdir('.').catch(() => []);
  const agentFiles = currentDirFiles.filter((f) => f.endsWith('.agent.md'));
  if (agentFiles.length === 1) {
    return agentFiles[0];
  }
  if (agentFiles.length > 1) {
    console.log(
      chalk.yellow('Multiple agent files found. Please specify one:')
    );
    for (const file of agentFiles) {
      console.log(`  - ${file}`);
    }
    return null;
  }

  // Look in agents directory
  if (existsSync('agents')) {
    const agentsDir = await readdir('agents').catch(() => []);
    const agentMdFiles = agentsDir.filter((f) => f.endsWith('.agent.md'));
    if (agentMdFiles.length === 1) {
      return join('agents', agentMdFiles[0]);
    }
    if (agentMdFiles.length > 1) {
      console.log(
        chalk.yellow('Multiple agent files found. Please specify one:')
      );
      for (const file of agentMdFiles) {
        console.log(`  - agents/${file}`);
      }
      return null;
    }
  }

  return null;
};

/**
 * Publish command - publish agent to registry
 */
export const publishCommand = async (
  pathArg?: string,
  options: PublishOptions = {}
): Promise<void> => {
  try {
    // 1. Check authentication
    const authStatus = await getAuthStatus();
    if (authStatus.status === 'expired') {
      console.error(chalk.red('❌ Session expired.'));
      console.log('Run', chalk.cyan('agent login'), 'to authenticate again.');
      process.exit(1);
    }
    if (authStatus.status === 'not_authenticated') {
      console.error(chalk.red('❌ Not logged in.'));
      console.log('Run', chalk.cyan('agent login'), 'to authenticate.');
      process.exit(1);
    }

    // 2. Find agent file
    const agentPath = await resolveAgentPath(pathArg);
    if (!agentPath) {
      console.error(chalk.red('❌ No agent file found.'));
      console.log(
        'Specify a path or run from a directory with a .agent.md file.'
      );
      process.exit(1);
    }

    // 3. Read and parse
    console.log(chalk.gray(`Reading ${agentPath}...`));
    const { frontmatter, content } = await readAgentFile(agentPath);

    // 4. Validate required fields
    if (!frontmatter.name) {
      console.error(chalk.red('❌ Agent must have a name in frontmatter.'));
      console.log(
        chalk.gray('Add "name: your-agent-name" to the YAML frontmatter.')
      );
      process.exit(1);
    }

    if (!isValidAgentName(frontmatter.name)) {
      console.error(chalk.red('❌ Invalid agent name.'));
      console.log(
        chalk.gray(
          'Name must be lowercase alphanumeric with hyphens (e.g., my-agent).'
        )
      );
      process.exit(1);
    }

    // 5. Determine version
    const version =
      options.version || frontmatter.version || generateDateVersion();
    const visibility = options.visibility || 'public';

    // 6. Dry run check
    if (options.dryRun) {
      console.log();
      console.log(chalk.cyan('📋 Dry run - would publish:'));
      console.log(`   Name:        ${chalk.bold(frontmatter.name)}`);
      console.log(`   Version:     ${chalk.bold(version)}`);
      console.log(`   Visibility:  ${chalk.bold(visibility)}`);
      if (frontmatter.description) {
        console.log(`   Description: ${frontmatter.description}`);
      }
      if (options.tag && options.tag.length > 0) {
        console.log(`   Tags:        ${options.tag.join(', ')}`);
      }
      if (options.changelog) {
        console.log(`   Changelog:   ${options.changelog}`);
      }
      console.log();
      return;
    }

    // 7. Publish
    console.log(chalk.cyan(`📤 Publishing ${frontmatter.name}@${version}...`));

    const result = await publishAgent({
      name: frontmatter.name,
      description: frontmatter.description,
      visibility,
      version,
      content,
      contentType: 'markdown',
      tags: options.tag,
      changelog: options.changelog,
    });

    // 8. Success
    console.log();
    console.log(
      chalk.green(
        `✅ Published ${result.owner}/${result.name}@${result.version}`
      )
    );
    console.log(
      chalk.gray(
        `   Install with: agent install ${result.owner}/${result.name}`
      )
    );
    console.log();
  } catch (error) {
    if (error instanceof RegistryApiError) {
      console.error(chalk.red(`❌ ${error.message}`));
      if (error.details) {
        for (const [field, msg] of Object.entries(error.details)) {
          console.error(chalk.gray(`   ${field}: ${msg}`));
        }
      }
      if (error.code === 'version_exists') {
        console.log(chalk.gray('   Use --version to specify a newer version.'));
      }
    } else {
      console.error(chalk.red(`❌ Failed: ${(error as Error).message}`));
    }
    process.exit(1);
  }
};
