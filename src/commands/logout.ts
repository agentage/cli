import chalk from 'chalk';
import { logout as logoutApi } from '../services/auth.service.js';
import { clearAuth, loadAuth } from '../utils/config.js';

/**
 * Logout command - clear stored credentials
 */
export const logoutCommand = async (): Promise<void> => {
  try {
    // Check if logged in
    const auth = await loadAuth();
    if (!auth.token) {
      console.log(chalk.yellow('Not logged in.'));
      return;
    }

    // Get user info before clearing
    const userName = auth.user?.name || auth.user?.email;

    // Attempt server-side logout (optional, ignore errors)
    console.log(chalk.gray('Logging out...'));
    await logoutApi();

    // Clear auth.json only — config.json (deviceId, registry) is preserved
    await clearAuth();

    console.log();
    if (userName) {
      console.log(chalk.green('✅ Logged out from'), chalk.bold(userName));
    } else {
      console.log(chalk.green('✅ Logged out successfully.'));
    }
  } catch {
    // Even if server logout fails, clear local credentials
    await clearAuth();
    console.log(chalk.green('✅ Logged out locally.'));
    console.log(chalk.gray('(Server logout may have failed, but local credentials cleared)'));
  }
};
