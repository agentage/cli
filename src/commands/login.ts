import { type Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { saveAuth, type AuthState } from '../hub/auth.js';
import { startCallbackServer, getCallbackPort } from '../hub/auth-callback.js';
import { loadConfig, saveConfig } from '../daemon/config.js';

const DEFAULT_HUB_URL = 'https://agentage.io';

export const registerLogin = (program: Command): void => {
  program
    .command('login')
    .description('Authenticate with hub')
    .option('--hub <url>', 'Hub URL', DEFAULT_HUB_URL)
    .option('--token <token>', 'Use access token directly (headless/CI)')
    .action(async (opts: { hub: string; token?: string }) => {
      await ensureDaemon();

      const hubUrl = opts.hub;

      if (opts.token) {
        // Direct token mode — for headless/CI
        console.log(chalk.yellow('Direct token login — skipping browser flow'));
        console.log(
          chalk.yellow(
            'Note: refresh tokens are not available in direct mode. Session will expire.'
          )
        );

        const config = loadConfig();
        const authState: AuthState = {
          session: {
            access_token: opts.token,
            refresh_token: '',
            expires_at: 0,
          },
          user: { id: '', email: '' },
          hub: { url: hubUrl, machineId: config.machine.id },
        };

        saveAuth(authState);

        // Save hub URL to config
        config.hub = { url: hubUrl };
        saveConfig(config);

        console.log(chalk.green('Logged in with token.'));
        return;
      }

      // Fetch supabase config from hub health endpoint
      let supabaseUrl: string;
      let supabaseAnonKey: string;

      try {
        const healthRes = await fetch(`${hubUrl}/api/health`);
        const health = (await healthRes.json()) as {
          success: boolean;
          data: { supabaseUrl: string; supabaseAnonKey: string };
        };
        supabaseUrl = health.data.supabaseUrl;
        supabaseAnonKey = health.data.supabaseAnonKey;
      } catch {
        console.error(chalk.red(`Cannot reach hub at ${hubUrl}. Check the URL and try again.`));
        process.exitCode = 1;
        return;
      }

      // Start callback server, then open browser
      console.log('Opening browser for authentication...');

      const authPromise = startCallbackServer(supabaseUrl, supabaseAnonKey);

      // Wait a tick for the server to start, then get the port
      await new Promise((r) => setTimeout(r, 100));
      const port = getCallbackPort();

      if (!port) {
        console.error(chalk.red('Failed to start callback server'));
        process.exitCode = 1;
        return;
      }

      const redirectUrl = `http://localhost:${port}/auth/callback`;
      const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectUrl)}`;

      try {
        await open(authUrl);
      } catch {
        // Browser didn't open — print URL manually
        console.log(chalk.yellow('Could not open browser. Open this URL manually:'));
        console.log(authUrl);
      }

      console.log('Waiting for login...');

      try {
        const authState = await authPromise;

        // Set hub info
        authState.hub.url = hubUrl;
        const config = loadConfig();
        authState.hub.machineId = config.machine.id;

        saveAuth(authState);

        // Save hub URL to config
        config.hub = { url: hubUrl };
        saveConfig(config);

        console.log(chalk.green(`✓ Logged in as ${authState.user.email}`));
        console.log(
          `Machine "${config.machine.name}" will register with hub on next daemon restart.`
        );
        console.log(chalk.dim('Run `agentage daemon restart` to connect now.'));
      } catch (err) {
        console.error(
          chalk.red(`Login failed: ${err instanceof Error ? err.message : String(err)}`)
        );
        process.exitCode = 1;
      }
    });
};
