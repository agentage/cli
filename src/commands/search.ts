import chalk from 'chalk';
import {
  RegistryApiError,
  searchAgents,
} from '../services/registry.service.js';

interface SearchOptions {
  limit?: string;
  page?: string;
  json?: boolean;
}

/**
 * Search command - search for agents in registry
 */
export const searchCommand = async (
  query: string,
  options: SearchOptions = {}
): Promise<void> => {
  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 10;
    const page = options.page ? parseInt(options.page, 10) : 1;

    console.log(chalk.cyan(`🔍 Searching for "${query}"...\n`));

    const result = await searchAgents(query, page, limit);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // No results
    if (result.agents.length === 0) {
      console.log(chalk.yellow('No agents found.'));
      return;
    }

    // Display results
    console.log(
      chalk.white.bold(
        `Found ${result.total} agent${result.total !== 1 ? 's' : ''}:\n`
      )
    );

    for (const agent of result.agents) {
      console.log(chalk.cyan.bold(`  ${agent.owner}/${agent.name}`));
      console.log(chalk.gray(`    ${agent.description || 'No description'}`));
      console.log(
        chalk.gray(
          `    v${agent.latestVersion} • ${agent.totalDownloads} downloads`
        )
      );
      if (agent.tags && agent.tags.length > 0) {
        console.log(chalk.gray(`    Tags: ${agent.tags.join(', ')}`));
      }
      console.log();
    }

    // Pagination info
    if (result.hasMore) {
      console.log(
        chalk.gray(
          `Showing ${result.agents.length} of ${result.total}. Use --page ${
            page + 1
          } for more.`
        )
      );
    }
  } catch (error) {
    if (error instanceof RegistryApiError) {
      console.error(chalk.red(`❌ ${error.message}`));
    } else {
      console.error(chalk.red(`❌ Failed: ${(error as Error).message}`));
    }
    process.exit(1);
  }
};
