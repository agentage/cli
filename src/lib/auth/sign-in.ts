import chalk from 'chalk';
import { deleteAuth, ensureConfigDir, mutateAuth, readAuth, type AuthState } from '../fs/config.js';
import { links, siteFqdn } from '../net/origins.js';
import { AuthRequiredError } from './auth-errors.js';
import { startCallbackServer, type CallbackServer } from './callback-server.js';
import { detectEnvMismatch, type AuthEnvMismatch } from './env-match.js';
import { introspectToken } from './introspect.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  pkcePair,
  randomState,
  registerClient,
  revokeToken,
  tokensFrom,
} from './oauth.js';

export interface SignInOptions {
  reauth?: boolean;
  browser?: boolean;
}

export type SignInResult = 'signed-in' | 'already' | 'mismatch-resigned';

export interface SignInDeps {
  register: typeof registerClient;
  exchange: typeof exchangeCode;
  revoke: typeof revokeToken;
  startServer: typeof startCallbackServer;
  openBrowser: (url: string) => Promise<void>;
  introspect: typeof introspectToken;
  log: (msg: string) => void;
}

const defaultDeps: SignInDeps = {
  register: registerClient,
  exchange: exchangeCode,
  revoke: revokeToken,
  startServer: startCallbackServer,
  openBrowser: async (url) => {
    const { default: open } = await import('open');
    await open(url);
  },
  introspect: introspectToken,
  log: (msg) => console.log(msg),
};

interface Grant {
  clientId: string;
  code: string;
  verifier: string;
}

const promptBrowser = async (url: string, opts: SignInOptions, deps: SignInDeps) => {
  deps.log(`\nSign in to agentage (${siteFqdn()}):\n\n  ${url}\n`);
  if (opts.browser === false) deps.log('Open the URL above in a browser to continue.');
  else
    await deps
      .openBrowser(url)
      .catch(() => deps.log('Could not open a browser - use the URL above.'));
  deps.log('Waiting for sign-in to complete...');
};

const authorize = async (
  server: CallbackServer,
  state: string,
  opts: SignInOptions,
  deps: SignInDeps
): Promise<Grant> => {
  const authUrl = links(siteFqdn()).auth;
  const { verifier, challenge } = pkcePair();
  const clientId = await deps.register(authUrl, server.redirectUri);
  const redirectUri = server.redirectUri;
  const url = buildAuthorizeUrl(authUrl, { clientId, redirectUri, challenge, state });
  await promptBrowser(url, opts, deps);
  return { clientId, verifier, code: await server.waitForCode() };
};

// A fresh DCR client per run: the redirect URI binds this run's ephemeral callback port.
export const signIn = async (
  opts: SignInOptions,
  deps: SignInDeps = defaultDeps
): Promise<void> => {
  const fqdn = siteFqdn();
  ensureConfigDir();
  const state = randomState();
  const server = await deps.startServer(state);
  try {
    const { clientId, code, verifier } = await authorize(server, state, opts, deps);
    const redirectUri = server.redirectUri;
    const res = await deps.exchange(links(fqdn).auth, { clientId, code, redirectUri, verifier });
    await mutateAuth(() => ({ siteFqdn: fqdn, clientId, tokens: tokensFrom(res) }));
    deps.log(chalk.green('\nSigned in.\n'));
  } finally {
    server.close();
  }
};

export const signOut = async (deps: SignInDeps = defaultDeps): Promise<void> => {
  const auth = readAuth();
  if (!auth) {
    deps.log('Nothing to disconnect.');
    return;
  }
  await deps.revoke(links(auth.siteFqdn).auth, auth.tokens.accessToken);
  await deleteAuth();
  deps.log('Disconnected - local credentials removed.');
};

const mismatchNote = (m: AuthEnvMismatch): string =>
  `Signed in to ${m.credentialFqdn} (${m.credentialEnv}), but this run targets ` +
  `${m.targetFqdn} (${m.targetEnv}) - signing you into ${m.targetEnv}.\n`;

// Only a dead session re-signs: a transient verify failure keeps the credentials.
const verifyStored = async (auth: AuthState, deps: SignInDeps): Promise<boolean> => {
  try {
    await deps.introspect(auth, links(auth.siteFqdn));
    deps.log(
      `Already signed in. Run ${chalk.white('agentage setup --reauth')} to sign in again.\n`
    );
    return true;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      deps.log('Session expired - signing you in again.\n');
      return false;
    }
    deps.log('You appear signed in (could not fully verify - temporary).\n');
    return true;
  }
};

// Never introspect a credential against another environment: it would misread as expired.
export const ensureSignedIn = async (
  opts: SignInOptions,
  deps: SignInDeps = defaultDeps
): Promise<SignInResult> => {
  const stored = readAuth();
  const mismatch = stored && !opts.reauth ? detectEnvMismatch(stored, siteFqdn()) : null;
  if (mismatch) deps.log(mismatchNote(mismatch));
  else if (stored && !opts.reauth && (await verifyStored(stored, deps))) return 'already';
  await signIn(opts, deps);
  return mismatch ? 'mismatch-resigned' : 'signed-in';
};
