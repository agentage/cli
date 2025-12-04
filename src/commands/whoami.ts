import chalk from 'chalk';
import { AuthError, getMe } from '../services/auth.service.js';
import { getRegistryUrl, isTokenExpired, loadConfig } from '../utils/config.js';

/**
 * Whoami command - display current authenticated user
 */
export const whoamiCommand = async (): Promise<void> => {
  try {
    // Check if token exists locally
    const config = await loadConfig();
    if (!config.auth?.token) {
      console.log(chalk.yellow('Not logged in.'));
      console.log('Run', chalk.cyan('agent login'), 'to authenticate.');
      return;
    }

    // Check if token is expired locally
    if (isTokenExpired(config.auth.expiresAt)) {
      console.log(chalk.yellow('⚠️  Session expired.'));
      console.log('Run', chalk.cyan('agent login'), 'to authenticate again.');
      process.exit(1);
    }

    // Fetch current user from API
    console.log(chalk.gray('Checking authentication...'));
    const user = await getMe();

    const registryUrl = await getRegistryUrl();
    console.log();
    console.log(chalk.green('✅ Logged in to'), chalk.cyan(registryUrl));
    console.log();
    console.log(chalk.bold('User Information:'));
    console.log();
    if (user.name) {
      console.log('  Name: ', chalk.bold(user.name));
    }
    console.log('  Email:', chalk.bold(user.email));
    if (user.verifiedAlias) {
      console.log('  Alias:', chalk.bold(user.verifiedAlias));
    }
    console.log('  ID:   ', chalk.gray(user.id));
    console.log();
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === 'not_authenticated') {
        console.log(chalk.yellow('Not logged in.'));
        console.log('Run', chalk.cyan('agent login'), 'to authenticate.');
      } else if (error.code === 'session_expired') {
        console.log(chalk.yellow('⚠️  Session expired.'));
        console.log('Run', chalk.cyan('agent login'), 'to authenticate again.');
      } else {
        console.error(chalk.red('❌ Error:'), error.message);
      }
    } else {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
    }
    process.exit(1);
  }
};
