import { mutateAuth, type AuthState, type StoredTokens } from '../fs/config.js';
import { refreshTokens, TokenRequestError } from './oauth.js';
import { type Links } from '../net/origins.js';
import { requestHeaders } from '../net/user-agent.js';
import { AuthRequiredError, isTerminalRefresh, TransientAuthError } from './auth-errors.js';

export { AuthRequiredError, TransientAuthError } from './auth-errors.js';

// Every authed call is CLI-originated; identify the caller alongside the bearer.
const cliHeaders = (): Record<string, string> => requestHeaders({ component: 'cli' });

// Refresh the stored token in place. On success mutates auth + persists and returns. On failure it
// throws: AuthRequiredError when the grant is dead (401/invalid_grant/invalid_client), else
// TransientAuthError (429/5xx/network/timeout) - a blip that must not be read as a dead session.
export const refreshOrThrow = async (auth: AuthState, links: Links): Promise<void> => {
  if (auth.kind === 'pat')
    throw new AuthRequiredError(
      'personal access token expired or revoked - mint a new one in the dashboard (Settings -> API tokens)'
    );
  if (!auth.tokens.refreshToken) throw new AuthRequiredError('no refresh token');
  let fresh;
  try {
    fresh = await refreshTokens(links.auth, auth.clientId, auth.tokens.refreshToken);
  } catch (err) {
    if (err instanceof TokenRequestError && isTerminalRefresh(err.status, err.oauthError))
      throw new AuthRequiredError('session expired');
    throw new TransientAuthError('refresh temporarily failed');
  }
  const tokens: StoredTokens = {
    accessToken: fresh.access_token,
    refreshToken: fresh.refresh_token ?? auth.tokens.refreshToken,
    expiresAt: fresh.expires_in ? Date.now() + fresh.expires_in * 1000 : undefined,
  };
  auth.tokens = tokens; // the caller retries its request with this in-memory copy
  // Persist under the lock, folding the new tokens onto the freshly-read state so a concurrent
  // writer's other fields (clientId, siteFqdn) are not clobbered by a stale in-memory copy.
  await mutateAuth((current) => {
    const base = current ?? auth;
    base.tokens = tokens;
    return base;
  });
};

// Boolean shim for the request paths that just want "refresh once, then retry": any failure
// (terminal or transient) collapses to false so they fall through to their own status handling.
const tryRefresh = async (auth: AuthState, links: Links): Promise<boolean> => {
  try {
    await refreshOrThrow(auth, links);
    return true;
  } catch {
    return false;
  }
};

// The current OAuth bearer for background (couch) sync. Reads auth.json fresh on every call - the
// user may sign in or out between ticks - and refreshes once when the stored token is past its
// stated expiry. Returns null when signed out so a caller pauses with zero network, never throws.
export const currentBearer = async (
  readAuth: () => AuthState | null,
  links: Links
): Promise<string | null> => {
  const auth = readAuth();
  if (!auth?.tokens.accessToken) return null;
  const expired = auth.tokens.expiresAt !== undefined && auth.tokens.expiresAt <= Date.now();
  if (expired && !(await tryRefresh(auth, links))) return null;
  return auth.tokens.accessToken;
};

// redirect: 'manual' so the bearer is never replayed to a redirect target; any 3xx is an error.
const isRedirect = (res: Response): boolean =>
  res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);

export const authedGet = async <T>(auth: AuthState, links: Links, url: string): Promise<T> => {
  const call = (): Promise<Response> =>
    fetch(url, {
      headers: { authorization: `Bearer ${auth.tokens.accessToken}`, ...cliHeaders() },
      redirect: 'manual',
    });
  let res = await call();
  if (res.status === 401 && (await tryRefresh(auth, links))) res = await call();
  if (res.status === 401) throw new AuthRequiredError('session expired');
  if (isRedirect(res)) throw new Error(`GET ${url} refused redirect (${res.status})`);
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
  return (await res.json()) as T;
};

// A bearer POST with the same refresh-once dance as authedGet. Unlike authedGet it returns the
// raw Response (never throws on a non-2xx): callers branch on the status codes themselves.
export const authedPost = async (
  auth: AuthState,
  links: Links,
  url: string,
  body: unknown
): Promise<Response> => {
  const call = (): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.tokens.accessToken}`,
        'content-type': 'application/json',
        ...cliHeaders(),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  let res = await call();
  if (res.status === 401 && (await tryRefresh(auth, links))) res = await call();
  return res;
};

// Re-export the introspection surface so existing callers keep importing from './api.js'.
export { introspectToken, type TokenSession } from './introspect.js';
