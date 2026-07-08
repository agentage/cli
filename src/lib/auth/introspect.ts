import { type AuthState } from '../fs/config.js';
import { type Links } from '../net/origins.js';
import { authedGet, refreshOrThrow } from './api.js';
import { AuthRequiredError, TransientAuthError } from './auth-errors.js';

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // unref so a pending backoff never keeps `status` from exiting.
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });

// Introspection over global fetch: a network error reflects as a transient (a blip must not read as
// a dead session), never letting the raw error escape to gatherStatus. Only a 401 stays terminal.
const getSession = async (auth: AuthState, links: Links): Promise<IntrospectionResponse | null> => {
  const url = `${links.auth}/api/auth/mcp/get-session`;
  try {
    return await authedGet<IntrospectionResponse | null>(auth, links, url);
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err;
    throw new TransientAuthError('get-session temporarily failed');
  }
};

const mapSession = (body: IntrospectionResponse): TokenSession => ({
  userId: body.userId,
  expiresAt: body.accessTokenExpiresAt,
});

const isUnexpired = (auth: AuthState): boolean =>
  auth.tokens.expiresAt !== undefined && auth.tokens.expiresAt > Date.now();

// A cosmetic freshen when get-session returns a present-but-past-expiry body: refresh to display the
// post-refresh expiry, but tolerate a transient refresh failure by keeping the present body.
const freshenIfStale = async (
  auth: AuthState,
  links: Links,
  body: IntrospectionResponse
): Promise<TokenSession> => {
  if (!isPast(body.accessTokenExpiresAt)) return mapSession(body);
  try {
    await refreshOrThrow(auth, links);
  } catch (err) {
    if (err instanceof TransientAuthError) return mapSession(body); // keep the last good session
    throw err;
  }
  return mapSession((await getSession(auth, links)) ?? body);
};

// The OAuth introspection endpoint: the only live surface that validates the CLI's bearer today
// (backend REST accepts session cookies only). get-session answers 200 + null (not 401) for an
// inactive session, so the on-401 refresh never fires here. TERMINAL failures (401 / dead grant)
// throw AuthRequiredError; TRANSIENT ones (429/5xx/network/timeout) throw TransientAuthError so the
// caller renders a temporary note, never "session expired".
const introspectOnce = async (auth: AuthState, links: Links): Promise<TokenSession> => {
  const expired = auth.tokens.expiresAt !== undefined && auth.tokens.expiresAt <= Date.now();
  if (expired) await refreshOrThrow(auth, links); // throws AuthRequired or Transient by class
  // With an unexpired token, a transient get-session is not proof of a dead session: we still hold a
  // valid bearer, so report signed-in against the stored expiry rather than surfacing the blip.
  const holdUnexpired = isUnexpired(auth);
  let body: IntrospectionResponse | null;
  try {
    body = await getSession(auth, links);
  } catch (err) {
    if (holdUnexpired && err instanceof TransientAuthError)
      return { expiresAt: new Date(auth.tokens.expiresAt as number).toISOString() };
    throw err;
  }
  // 200 + null = definitive no-session: refresh is decisive (terminal -> expired, transient -> blip).
  if (!body) {
    await refreshOrThrow(auth, links);
    const after = await getSession(auth, links);
    if (!after) throw new AuthRequiredError('no active session');
    return mapSession(after);
  }
  return freshenIfStale(auth, links, body);
};

// A retry-once with a short unref'd backoff absorbs a lone transient blip; a terminal error skips it.
export const introspectToken = async (auth: AuthState, links: Links): Promise<TokenSession> => {
  try {
    return await introspectOnce(auth, links);
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err; // terminal: no point retrying a dead session
    await sleep(300);
    return introspectOnce(auth, links); // one transient-only retry; a 2nd transient propagates
  }
};
