import chalk from 'chalk';
import { deleteAuth, ensureConfigDir, mutateAuth, readAuth, type AuthState } from '../fs/config.js';
import { discoverTarget } from '../net/discovery.js';
import { siteFqdn, type Links } from '../net/origins.js';
import { AuthRequiredError } from './auth-errors.js';
import { startCallbackServer, type CallbackServer } from './callback-server.js';
import { credentialLinks, detectEnvMismatch, type AuthEnvMismatch } from './env-match.js';
import { introspectToken } from './introspect.js';
import { revokePlatformPats } from './platform-pat.js';
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
  // The target's links, its auth being the issuer the site's discovery names.
  discover: (fqdn: string) => Promise<Links>;
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
  discover: async (fqdn) => (await discoverTarget(fqdn)).links,
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
  deps: SignInDeps,
  authUrl: string
): Promise<Grant> => {
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
  const authUrl = (await deps.discover(fqdn)).auth;
  ensureConfigDir();
  const state = randomState();
  const server = await deps.startServer(state);
  try {
    const { clientId, code, verifier } = await authorize(server, state, opts, deps, authUrl);
    const redirectUri = server.redirectUri;
    const res = await deps.exchange(authUrl, { clientId, code, redirectUri, verifier });
    const tokens = tokensFrom(res);
    const old = readAuth();
    await mutateAuth(() => ({ siteFqdn: fqdn, issuer: authUrl, clientId, tokens }));
    if (old) await revokePlatformPats(old, tokens.accessToken);
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
  await revokePlatformPats(auth);
  await deps.revoke(credentialLinks(auth).auth, auth.tokens.accessToken);
  await deleteAuth();
  deps.log('Disconnected - local credentials removed.');
};

const mismatchNote = (m: AuthEnvMismatch): string =>
  `Signed in to ${m.credentialFqdn} (${m.credentialEnv}), but this run targets ` +
  `${m.targetFqdn} (${m.targetEnv}) - signing you into ${m.targetEnv}.\n`;

// Only a dead session re-signs: a transient verify failure keeps the credentials.
const verifyStored = async (auth: AuthState, deps: SignInDeps): Promise<boolean> => {
  try {
    await deps.introspect(auth, credentialLinks(auth));
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
  const stored = opts.reauth ? null : readAuth();
  const fqdn = siteFqdn();
  // Discovery is asked only when the derived issuer differs from the credential's, or to sign in.
  const derived = stored && detectEnvMismatch(stored, fqdn);
  const mismatch = derived && detectEnvMismatch(stored, fqdn, (await deps.discover(fqdn)).auth);
  if (mismatch) deps.log(mismatchNote(mismatch));
  else if (stored && (await verifyStored(stored, deps))) return 'already';
  await signIn(opts, deps);
  return mismatch ? 'mismatch-resigned' : 'signed-in';
};
