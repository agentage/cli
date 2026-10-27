import { mutateAuth, type AuthState, type StoredTokens } from '../fs/config.js';
import { cliFetch, isRedirect, type CliRequestInit } from '../net/fetch.js';
import { type Links } from '../net/origins.js';
import { AuthRequiredError, isTerminalRefresh, TransientAuthError } from './auth-errors.js';
import { refreshTokens, TokenRequestError, tokensFrom } from './oauth.js';

export { AuthRequiredError, TransientAuthError } from './auth-errors.js';

const requestTokens = async (auth: AuthState, links: Links, rt: string): Promise<StoredTokens> => {
  try {
    return tokensFrom(await refreshTokens(links.auth, auth.clientId, rt), rt);
  } catch (err) {
    if (err instanceof TokenRequestError && isTerminalRefresh(err.status, err.oauthError))
      throw new AuthRequiredError('session expired');
    throw new TransientAuthError('refresh temporarily failed');
  }
};

// Never resurrect a sign-out (null) or overwrite a newer sign-in by another client.
const persistTokens = async (clientId: string, tokens: StoredTokens): Promise<void> => {
  await mutateAuth((current) => {
    if (!current || current.clientId !== clientId) return null;
    current.tokens = tokens;
    return current;
  });
};

const refreshAndPersist = async (
  auth: AuthState,
  links: Links,
  rt: string
): Promise<StoredTokens> => {
  const tokens = await requestTokens(auth, links, rt);
  await persistTokens(auth.clientId, tokens);
  return tokens;
};

// Keyed by refresh token: parallel 401s share one grant instead of racing its rotation.
const inflight = new Map<string, Promise<StoredTokens>>();

const sharedRefresh = (auth: AuthState, links: Links, rt: string): Promise<StoredTokens> => {
  const pending = inflight.get(rt);
  if (pending) return pending;
  const next = refreshAndPersist(auth, links, rt).finally(() => inflight.delete(rt));
  inflight.set(rt, next);
  return next;
};

// Throws AuthRequiredError for a dead grant, TransientAuthError for a blip (429/5xx/network).
export const refreshOrThrow = async (auth: AuthState, links: Links): Promise<void> => {
  if (auth.kind === 'pat')
    throw new AuthRequiredError(
      'personal access token expired or revoked - mint a new one in the dashboard (Settings -> API tokens)'
    );
  const rt = auth.tokens.refreshToken;
  if (!rt) throw new AuthRequiredError('no refresh token');
  auth.tokens = await sharedRefresh(auth, links, rt); // the caller retries with this copy
};

const tryRefresh = async (auth: AuthState, links: Links): Promise<boolean> => {
  try {
    await refreshOrThrow(auth, links);
    return true;
  } catch {
    return false;
  }
};

const withBearer = (auth: AuthState, init: CliRequestInit): CliRequestInit => ({
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${auth.tokens.accessToken}` },
});

// The raw Response after at most one refresh-and-retry on 401; callers branch on the status.
export const authedFetch = async (
  auth: AuthState,
  links: Links,
  url: string,
  init: CliRequestInit = {}
): Promise<Response> => {
  const res = await cliFetch(url, withBearer(auth, init));
  if (res.status !== 401 || !(await tryRefresh(auth, links))) return res;
  await res.body?.cancel();
  return cliFetch(url, withBearer(auth, init));
};

export const authedJson = async <T>(
  auth: AuthState,
  links: Links,
  url: string,
  init: CliRequestInit = {}
): Promise<T> => {
  const method = init.method ?? 'GET';
  const res = await authedFetch(auth, links, url, init);
  if (res.status === 401) throw new AuthRequiredError('session expired');
  if (isRedirect(res)) throw new Error(`${method} ${url} refused redirect (${res.status})`);
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status})`);
  return (await res.json()) as T;
};

// Re-export the introspection surface so existing callers keep importing from './api.js'.
export { introspectToken, type TokenSession } from './introspect.js';
