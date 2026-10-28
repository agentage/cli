import { createHash } from 'node:crypto';
import { isRecord, json, oauthError, redirectTo, type Reply } from './http.js';
import {
  issueToken,
  liveAccess,
  liveRefresh,
  mint,
  STUB_USER_ID,
  type StubState,
  type StubToken,
} from './state.js';

const isUriList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string');

// DCR: a public client per call; the redirect URIs it registers are the only ones authorize trusts.
export const register = (state: StubState, body: unknown): Reply => {
  const meta = isRecord(body) ? body : {};
  const redirectUris = meta['redirect_uris'];
  if (!isUriList(redirectUris)) return oauthError(400, 'invalid_redirect_uri');
  const clientId = mint('client');
  state.clients.set(clientId, redirectUris);
  return json(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: meta['token_endpoint_auth_method'] ?? 'none',
  });
};

const isPkceCodeRequest = (q: URLSearchParams): boolean =>
  q.get('response_type') === 'code' &&
  !!q.get('code_challenge') &&
  q.get('code_challenge_method') === 'S256';

// Until the redirect URI is trusted, errors answer JSON; after that they go back to the client.
export const authorize = (state: StubState, q: URLSearchParams): Reply => {
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  const registered = state.clients.get(clientId);
  if (!registered) return oauthError(400, 'invalid_client');
  if (!registered.includes(redirectUri)) return oauthError(400, 'invalid_request');
  const st = q.get('state');
  if (!st || !isPkceCodeRequest(q)) return redirectTo(redirectUri, { error: 'invalid_request' });
  if (q.get('deny') === '1' || state.denyAuthorize)
    return redirectTo(redirectUri, { error: 'access_denied', state: st });
  const code = mint('code');
  const challenge = q.get('code_challenge') ?? '';
  const scope = q.get('scope') ?? '';
  state.codes.push({ code, clientId, redirectUri, challenge, scope, used: false });
  return redirectTo(redirectUri, { code, state: st });
};

const tokenReply = (state: StubState, token: StubToken): Reply =>
  json(200, {
    access_token: token.accessToken,
    token_type: 'Bearer',
    ...(token.expiresAt === null ? {} : { expires_in: state.expiresIn }),
    refresh_token: token.refreshToken,
    scope: token.scope,
  });

const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

// One-time code: consumed on first presentation, whether or not the rest checks out.
const codeGrant = (state: StubState, form: URLSearchParams): Reply => {
  const record = state.codes.find((c) => c.code === form.get('code') && !c.used);
  if (!record) return oauthError(400, 'invalid_grant');
  record.used = true;
  const ok =
    record.clientId === form.get('client_id') &&
    record.redirectUri === form.get('redirect_uri') &&
    s256(form.get('code_verifier') ?? '') === record.challenge;
  if (!ok) return oauthError(400, 'invalid_grant');
  return tokenReply(state, issueToken(state, record.clientId, record.scope));
};

// Rotation: the presented refresh token dies here, so a replay of it is an invalid_grant.
const refreshGrant = (state: StubState, form: URLSearchParams): Reply => {
  const old = liveRefresh(state, form.get('refresh_token') ?? '');
  if (!old) return oauthError(400, 'invalid_grant');
  if (old.clientId !== form.get('client_id')) return oauthError(401, 'invalid_client');
  old.rotated = true;
  return tokenReply(state, issueToken(state, old.clientId, old.scope));
};

export const token = (state: StubState, form: URLSearchParams): Reply => {
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') return codeGrant(state, form);
  if (grant === 'refresh_token') return refreshGrant(state, form);
  return oauthError(400, 'unsupported_grant_type');
};

const sessionBody = (token: StubToken): object => ({
  userId: STUB_USER_ID,
  clientId: token.clientId,
  scopes: token.scope,
  ...(token.expiresAt === null
    ? {}
    : { accessTokenExpiresAt: new Date(token.expiresAt).toISOString() }),
});

// Like the real AS: a missing, unknown, revoked or expired bearer is 200 + null, never a 401.
export const getSession = (state: StubState, authorization?: string): Reply => {
  if (state.transientGetSession > 0) {
    state.transientGetSession -= 1;
    return oauthError(503, 'temporarily_unavailable');
  }
  const live = liveAccess(state, (authorization ?? '').replace(/^Bearer /i, ''));
  return json(200, live ? sessionBody(live) : null);
};

// RFC 7009: always 200; the access or refresh token presented kills the whole pair.
export const revoke = (state: StubState, form: URLSearchParams): Reply => {
  const value = form.get('token') ?? '';
  if (value) state.revocations.push(value);
  for (const t of state.tokens)
    if (value && (t.accessToken === value || t.refreshToken === value)) t.revoked = true;
  return { status: 200 };
};
