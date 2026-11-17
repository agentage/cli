import { type Command } from 'commander';
import { refreshOrThrow } from '../../lib/auth/api.js';
import { AuthRequiredError } from '../../lib/auth/auth-errors.js';
import { credentialLinks } from '../../lib/auth/env-match.js';
import { readAuth, type AuthState } from '../../lib/fs/config.js';
import { addJson } from '../../lib/json-output.js';
import { helpOrUnknown } from '../extension/list.js';
import { type Links } from '../../lib/net/origins.js';

export interface AuthTokenOptions {
  json?: boolean;
}

export interface SessionToken {
  accessToken: string;
  // ISO time; null when the issuer named no lifetime.
  expiresAt: string | null;
}

export interface AuthTokenDeps {
  read: () => AuthState | null;
  refresh: (auth: AuthState, links: Links) => Promise<void>;
  now: () => number;
}

const defaultDeps: AuthTokenDeps = { read: readAuth, refresh: refreshOrThrow, now: Date.now };

// A token that lives under this long is refreshed first, so the caller can still use it.
export const MIN_LIFE_MS = 60_000;

const fresh = (auth: AuthState | null, now: number): auth is AuthState =>
  !!auth && auth.kind !== 'pat' && (auth.tokens.expiresAt ?? 0) - now >= MIN_LIFE_MS;

// Another process may have rotated the refresh token first: its stored, fresh token serves.
const refreshed = async (auth: AuthState, deps: AuthTokenDeps): Promise<AuthState> => {
  try {
    await deps.refresh(auth, credentialLinks(auth));
    return auth;
  } catch (err) {
    const stored = deps.read();
    if (!(err instanceof AuthRequiredError) || !fresh(stored, deps.now())) throw err;
    if (stored.tokens.accessToken === auth.tokens.accessToken) throw err;
    return stored;
  }
};

// Only the stored session: AGENTAGE_TOKEN (a PAT) is never read here, so it is never printed.
export const runAuthToken = async (
  opts: AuthTokenOptions = {},
  deps: AuthTokenDeps = defaultDeps
): Promise<SessionToken> => {
  const auth = deps.read();
  if (!auth || auth.kind === 'pat')
    throw new AuthRequiredError('not signed in - run: agentage setup');
  const live = fresh(auth, deps.now()) ? auth : await refreshed(auth, deps);
  const { accessToken, expiresAt } = live.tokens;
  // With --json the token goes only into the envelope on stdout, never to stderr.
  if (!opts.json) console.log(accessToken);
  return {
    accessToken,
    expiresAt: expiresAt === undefined ? null : new Date(expiresAt).toISOString(),
  };
};

const HELP = `
Prints a short-lived access token of the signed-in session on stdout, refreshed first when it
expires within 60 s; --json gives { accessToken, expiresAt }. It never prints a personal access
token (AGENTAGE_TOKEN). Signed out, it exits 1 with auth_required. The desktop uses it.`;

export const registerAuth = (
  program: Command,
  token: (opts: AuthTokenOptions) => Promise<void>
) => {
  const group = program
    .command('auth', { hidden: true })
    .description('The session of this machine, for other local clients')
    .allowExcessArguments()
    .action(helpOrUnknown);
  addJson(group.command('token').description('Print a fresh session access token'))
    .addHelpText('after', HELP)
    .action(token);
};
