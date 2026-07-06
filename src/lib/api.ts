import { saveAuth, type AuthState } from './config.js';
import { refreshTokens } from './oauth.js';
import { type Links } from './origins.js';

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
    auth.tokens = {
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token ?? auth.tokens.refreshToken,
      expiresAt: fresh.expires_in ? Date.now() + fresh.expires_in * 1000 : undefined,
    };
    saveAuth(auth);
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

export const authedGet = async <T>(auth: AuthState, links: Links, url: string): Promise<T> => {
  const call = (): Promise<Response> =>
    fetch(url, { headers: { authorization: `Bearer ${auth.tokens.accessToken}` } });
  let res = await call();
  if (res.status === 401 && (await tryRefresh(auth, links))) res = await call();
  if (res.status === 401) throw new AuthRequiredError('session expired');
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

// The OAuth introspection endpoint: the only live surface that validates the
// CLI's bearer token today (backend REST accepts session cookies only).
export const introspectToken = async (auth: AuthState, links: Links): Promise<TokenSession> => {
  const body = await authedGet<IntrospectionResponse | null>(
    auth,
    links,
    `${links.auth}/api/auth/mcp/get-session`
  );
  // get-session returns 200 + null when the bearer maps to no active session.
  if (!body) throw new AuthRequiredError('no active session');
  return { userId: body.userId, expiresAt: body.accessTokenExpiresAt };
};
