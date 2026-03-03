import chalk from 'chalk';
import {
  AuthError,
  pollForToken,
  requestDeviceCode,
} from '../services/auth.service.js';
import { getRegistryUrl, loadAuth, saveAuth } from '../utils/config.js';

/**
 * Login command - authenticate via device authorization flow
 */
export const loginCommand = async (): Promise<void> => {
  try {
    // Check if already logged in
    const auth = await loadAuth();
    if (auth.token) {
      console.log(
        chalk.yellow('⚠️  Already logged in.'),
        'Run',
        chalk.cyan('agent logout'),
        'first to switch accounts.'
      );
      return;
    }

    const registryUrl = await getRegistryUrl();
    console.log(chalk.blue('🔐 Logging in to'), chalk.cyan(registryUrl));
    console.log();

    // Request device code
    console.log(chalk.gray('Requesting authentication code...'));
    const deviceCode = await requestDeviceCode();

    // Display instructions
    console.log();
    console.log(chalk.bold('To complete login:'));
    console.log();
    console.log(
      '  1. Open:',
      chalk.cyan.underline(deviceCode.verification_uri)
    );
    console.log('  2. Enter code:', chalk.bold.yellow(deviceCode.user_code));
    console.log();

    // Try to open browser automatically
    try {
      const open = await import('open');
      await open.default(deviceCode.verification_uri);
      console.log(chalk.gray('(Browser opened automatically)'));
    } catch {
      console.log(
        chalk.gray(
          '(Could not open browser automatically - please open manually)'
        )
      );
    }

    console.log();
    console.log(chalk.gray('Waiting for authentication...'));

    // Poll for token
    const tokenResponse = await pollForToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in
    );

    // Save token to auth.json (config.json with deviceId/registry is untouched)
    await saveAuth({
      token: tokenResponse.access_token,
      user: tokenResponse.user,
      expiresAt: tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
        : undefined,
    });

    console.log();
    if (tokenResponse.user?.name) {
      console.log(
        chalk.green('✅ Logged in as'),
        chalk.bold(tokenResponse.user.name)
      );
    } else if (tokenResponse.user?.email) {
      console.log(
        chalk.green('✅ Logged in as'),
        chalk.bold(tokenResponse.user.email)
      );
    } else {
      console.log(chalk.green('✅ Login successful!'));
    }
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(chalk.red('❌ Login failed:'), error.message);
      if (error.code === 'expired_token') {
        console.log(
          chalk.gray('Run'),
          chalk.cyan('agent login'),
          chalk.gray('to try again.')
        );
      }
    } else {
      console.error(chalk.red('❌ Login failed:'), (error as Error).message);
    }
    process.exit(1);
  }
};
