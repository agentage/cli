import chalk from 'chalk';
import { type Command } from 'commander';
import { startCallbackServer } from '../lib/callback-server.js';
import { deleteAuth, ensureConfigDir, readAuth, saveAuth, type AuthState } from '../lib/config.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  pkcePair,
  randomState,
  registerClient,
  revokeToken,
  type TokenResponse,
} from '../lib/oauth.js';
import { links, siteFqdn } from '../lib/origins.js';
import { runStatus } from './status.js';

export interface SetupOptions {
  disconnect?: boolean;
  reauth?: boolean;
  browser?: boolean;
}

export interface SetupDeps {
  register: typeof registerClient;
  exchange: typeof exchangeCode;
  revoke: typeof revokeToken;
  startServer: typeof startCallbackServer;
  openBrowser: (url: string) => Promise<void>;
  printStatus: () => Promise<void>;
}

const defaultDeps: SetupDeps = {
  register: registerClient,
  exchange: exchangeCode,
  revoke: revokeToken,
  startServer: startCallbackServer,
  openBrowser: async (url) => {
    const { default: open } = await import('open');
    await open(url);
  },
  printStatus: () => runStatus({}),
};

const toAuthState = (fqdn: string, clientId: string, tokens: TokenResponse): AuthState => ({
  siteFqdn: fqdn,
  clientId,
  tokens: {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
  },
});

const disconnect = async (deps: SetupDeps): Promise<void> => {
  const auth = readAuth();
  if (!auth) {
    console.log('Nothing to disconnect.');
    return;
  }
  await deps.revoke(links(auth.siteFqdn).auth, auth.tokens.accessToken);
  deleteAuth();
  console.log('Disconnected - local credentials removed.');
};

export const runSetup = async (
  opts: SetupOptions,
  deps: SetupDeps = defaultDeps
): Promise<void> => {
  if (opts.disconnect) {
    await disconnect(deps);
    return;
  }
  if (readAuth() && !opts.reauth) {
    console.log(
      `Already signed in. Run ${chalk.white('agentage setup --reauth')} to sign in again.\n`
    );
    await deps.printStatus();
    return;
  }
  const fqdn = siteFqdn();
  const target = links(fqdn);
  ensureConfigDir();
  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const server = await deps.startServer(state);
  try {
    const clientId = await deps.register(target.auth, server.redirectUri);
    const url = buildAuthorizeUrl(target.auth, {
      clientId,
      redirectUri: server.redirectUri,
      challenge,
      state,
    });
    console.log(`\nSign in to agentage (${fqdn}):\n\n  ${url}\n`);
    if (opts.browser === false) console.log('Open the URL above in a browser to continue.');
    else
      await deps
        .openBrowser(url)
        .catch(() => console.log('Could not open a browser - use the URL above.'));
    console.log('Waiting for sign-in to complete...');
    const code = await server.waitForCode();
    const tokens = await deps.exchange(target.auth, {
      clientId,
      code,
      redirectUri: server.redirectUri,
      verifier,
    });
    saveAuth(toAuthState(fqdn, clientId, tokens));
    console.log(chalk.green('\nSigned in.\n'));
    await deps.printStatus();
  } finally {
    server.close();
  }
};

export const registerSetup = (program: Command): void => {
  program
    .command('setup')
    .description('Sign in and connect this machine to your agentage account')
    .option('--disconnect', 'sign out and remove local credentials')
    .option('--reauth', 'force a fresh sign-in')
    .option('--no-browser', 'print the sign-in URL instead of opening a browser')
    .action(async (opts: SetupOptions) => {
      try {
        await runSetup(opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Setup failed: ${message}`));
        process.exitCode = 1;
      }
    });
};
