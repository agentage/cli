import chalk from 'chalk';
import { type Command } from 'commander';
import { startCallbackServer } from '../../lib/auth/callback-server.js';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { daemonDisabled } from '../../lib/daemon/daemon-pref.js';
import {
  deleteAuth,
  ensureConfigDir,
  mutateAuth,
  readAuth,
  type AuthState,
} from '../../lib/fs/config.js';
import { AuthRequiredError, introspectToken } from '../../lib/auth/api.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  pkcePair,
  randomState,
  registerClient,
  revokeToken,
  type TokenResponse,
} from '../../lib/auth/oauth.js';
import { links, siteFqdn } from '../../lib/net/origins.js';
import { ensureVaultsConfig } from '../../lib/vault/vaults.js';
import { runStatus } from '../status/status.js';

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
  ensureDaemon: typeof ensureDaemon;
  introspect: typeof introspectToken;
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
  ensureDaemon,
  introspect: introspectToken,
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

// After sign-in, bring the daemon up so account sync starts immediately; ensureDaemon reuses a
// live daemon and starts a stopped one (idempotent). Honor the --no-daemon / AGENTAGE_NO_DAEMON
// disable switches.
const startDaemon = async (deps: SetupDeps): Promise<void> => {
  if (daemonDisabled()) {
    console.log('Daemon disabled - account sync will run in-process on demand.');
    return;
  }
  const client = await deps.ensureDaemon();
  const fail = 'Could not start the daemon - run: agentage daemon start';
  console.log(client ? 'Daemon running.' : fail);
};

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

// Validate the stored session instead of trusting mere token presence. Returns true to short-circuit
// (valid or a transient blip - creds intact), false to proceed into a fresh sign-in (truly expired).
const alreadySignedIn = async (auth: AuthState, deps: SetupDeps): Promise<boolean> => {
  try {
    await deps.introspect(auth, links(auth.siteFqdn));
    console.log(
      `Already signed in. Run ${chalk.white('agentage setup --reauth')} to sign in again.\n`
    );
    await deps.printStatus();
    return true;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      console.log('Session expired - signing you in again.\n');
      return false; // fall through to the sign-in flow, no --reauth needed
    }
    // Transient: do not force reauth on a blip; keep credentials and show status.
    console.log('You appear signed in (could not fully verify - temporary).\n');
    await deps.printStatus();
    return true;
  }
};

export const runSetup = async (
  opts: SetupOptions,
  deps: SetupDeps = defaultDeps
): Promise<void> => {
  if (opts.disconnect) {
    await disconnect(deps);
    return;
  }
  const stored = readAuth();
  if (stored && !opts.reauth && (await alreadySignedIn(stored, deps))) return;
  const fqdn = siteFqdn();
  const target = links(fqdn);
  ensureConfigDir();
  ensureVaultsConfig();
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
    await mutateAuth(() => toAuthState(fqdn, clientId, tokens));
    console.log(chalk.green('\nSigned in.\n'));
    await startDaemon(deps);
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
