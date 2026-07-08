import { mutateAuth, type AuthState, type StoredTokens } from '../fs/config.js';
import { refreshTokens } from './oauth.js';
import { type Links } from '../net/origins.js';

export class AuthRequiredError extends Error {
  constructor(message = 'not signed in') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

const tryRefresh = async (auth: AuthState, links: Links): Promise<boolean> => {
  if (!auth.tokens.refreshToken) return false;
  try {
    const fresh = await refreshTokens(links.auth, auth.clientId, auth.tokens.refreshToken);
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
      headers: { authorization: `Bearer ${auth.tokens.accessToken}` },
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
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  let res = await call();
  if (res.status === 401 && (await tryRefresh(auth, links))) res = await call();
  return res;
};

interface IntrospectionResponse {
  userId?: string;
  accessTokenExpiresAt?: string;
}

export interface TokenSession {
  userId?: string;
  expiresAt?: string;
}

const isPast = (iso?: string): boolean => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t <= Date.now();
};

// The OAuth introspection endpoint: the only live surface that validates the
// CLI's bearer token today (backend REST accepts session cookies only).
// get-session answers 200 + null (not 401) for an expired/inactive session, so authedGet's
// on-401 refresh never fires here. Mirror currentBearer: refresh proactively when the stored
// token is past expiry, reactively once when a 200 + null slips through, and once more when the
// returned session reports an already-past expiry - always re-introspect so the returned expiry
// reflects the post-refresh token and a checkmark never sits next to a stale timestamp.
export const introspectToken = async (auth: AuthState, links: Links): Promise<TokenSession> => {
  const url = `${links.auth}/api/auth/mcp/get-session`;
  const get = (): Promise<IntrospectionResponse | null> =>
    authedGet<IntrospectionResponse | null>(auth, links, url);
  const expired = auth.tokens.expiresAt !== undefined && auth.tokens.expiresAt <= Date.now();
  if (expired && !(await tryRefresh(auth, links))) throw new AuthRequiredError('session expired');
  let body = await get();
  const stale = !body || isPast(body.accessTokenExpiresAt);
  if (stale && (await tryRefresh(auth, links))) body = await get();
  if (!body) throw new AuthRequiredError('no active session');
  return { userId: body.userId, expiresAt: body.accessTokenExpiresAt };
};
