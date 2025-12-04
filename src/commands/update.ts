import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  getInstalledVersion,
  getLatestVersion,
  PACKAGE_NAME,
} from '../utils/version.js';

const execAsync = promisify(exec);

export interface UpdateResult {
  success: boolean;
  previousVersion: string;
  currentVersion: string;
  message: string;
}

export const updateCommand = async (): Promise<void> => {
  console.log(chalk.cyan('🔄 Checking for updates...'));

  try {
    const previousVersion = await getInstalledVersion();
    const latestVersion = await getLatestVersion();

    if (latestVersion === 'unknown') {
      console.error(
        chalk.red('❌ Failed to fetch latest version from npm registry')
      );
      process.exit(1);
    }

    if (previousVersion === latestVersion) {
      console.log(
        chalk.green(`✅ Already on the latest version (${latestVersion})`)
      );
      return;
    }

    console.log(
      chalk.yellow(
        `📦 Updating ${PACKAGE_NAME} from ${chalk.red(
          previousVersion
        )} to ${chalk.green.bold(latestVersion)}...`
      )
    );

    await execAsync(`npm install -g ${PACKAGE_NAME}@latest`);

    console.log(
      chalk.green.bold(`✅ Successfully updated to version ${latestVersion}`)
    );
  } catch (error) {
    console.error(chalk.red(`❌ Update failed: ${(error as Error).message}`));
    process.exit(1);
  }
};
