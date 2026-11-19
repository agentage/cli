import { readAuth, type AuthState } from '../fs/config.js';
import { siteFqdn } from '../net/origins.js';

// Personal access tokens (PATs) are opaque platform tokens minted in the dashboard (Settings ->
// API tokens). They are `oauthAccessToken` rows, so the cloud memory MCP + the OAuth introspection
// endpoint validate them exactly like an OAuth access token - anywhere the CLI sends a stored
// access token, a PAT works as the bearer. They carry no refresh token and are non-interactive:
// they are the CI / headless credential.

export const PAT_PREFIX = 'aga_';

// Env var (CI-friendly, primary) and the per-command flag name for the PAT.
export const TOKEN_ENV_VAR = 'AGENTAGE_TOKEN';

export interface PatOptions {
  // An explicit per-command `--token <aga_...>` value; takes precedence over the env var.
  token?: string;
}

// A PAT is opaque; we only assert the `aga_` shape and non-empty tail so a copy-paste slip fails
// with a clear message instead of a raw 401 later. The server is the real validator.
export const isPatShape = (value: string): boolean =>
  value.startsWith(PAT_PREFIX) && value.length > PAT_PREFIX.length;

export const assertPatShape = (value: string): string => {
  const token = value.trim();
  if (!isPatShape(token))
    throw new Error(
      `token must be a personal access token starting with "${PAT_PREFIX}" ` +
        `(mint one in the dashboard: Settings -> API tokens)`
    );
  return token;
};

// The raw PAT from flag > env, or undefined when neither is set. An empty/whitespace env value is
// treated as unset so a stray `export AGENTAGE_TOKEN=` never shadows a stored OAuth session.
export const rawPatToken = (opts: PatOptions = {}): string | undefined => {
  if (opts.token !== undefined && opts.token.trim() !== '') return opts.token.trim();
  const env = process.env[TOKEN_ENV_VAR];
  if (env !== undefined && env.trim() !== '') return env.trim();
  return undefined;
};

// A synthesized AuthState backed by a PAT: the token rides through as the bearer everywhere an
// OAuth access token would. `kind: 'pat'` marks it so refresh / OAuth-session-only paths can fail
// with a clear message instead of attempting an impossible refresh. siteFqdn is pinned to the
// current target so the env-mismatch guard never fires (a PAT is not tied to a stored environment).
export const patAuthState = (token: string, fqdn: string = siteFqdn()): AuthState => {
  const accessToken = assertPatShape(token);
  const issuer = jwtPatIssuer(accessToken);
  return {
    siteFqdn: fqdn,
    clientId: 'pat',
    kind: 'pat',
    tokens: { accessToken },
    ...(issuer && { issuer }),
  };
};

// A JWT PAT (aga_<jwt>) is not introspectable: its claims are read here, the platform verifies it.
const jwtPatClaims = (token: string): Record<string, unknown> => {
  const payload = token.slice(PAT_PREFIX.length).split('.')[1] ?? '';
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const jwtPatExpiry = (token: string): string | null => {
  const { exp } = jwtPatClaims(token);
  return typeof exp === 'number' ? new Date(exp * 1000).toISOString() : null;
};

const LOOPBACK = new Set(['localhost', '127.0.0.1']);

// The issuer origin of a JWT PAT (https, or http on a loopback host); an opaque PAT has none.
export const jwtPatIssuer = (token: string): string | undefined => {
  const { iss } = jwtPatClaims(token);
  if (typeof iss !== 'string' || !URL.canParse(iss)) return undefined;
  const url = new URL(iss);
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  return ok ? url.origin : undefined;
};

// Resolve the active credential with precedence flag > env PAT > stored OAuth. When a PAT is
// present the OAuth/DCR flow is skipped entirely and the PAT is the bearer; otherwise fall back to
// the stored OAuth session on disk (null when signed out).
export const resolveAuth = (
  opts: PatOptions = {},
  read: () => AuthState | null = readAuth
): AuthState | null => {
  const pat = rawPatToken(opts);
  if (pat !== undefined) return patAuthState(pat);
  return read();
};
