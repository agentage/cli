import { createHash, randomBytes } from 'node:crypto';
import { requestHeaders } from '../net/user-agent.js';

// OAuth register/token/revoke are all CLI-originated; identify the caller on each.
const cliHeaders = (): Record<string, string> => requestHeaders({ component: 'cli' });

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

const REGISTER_PATH = '/api/auth/mcp/register';
const AUTHORIZE_PATH = '/api/auth/mcp/authorize';
const TOKEN_PATH = '/api/auth/mcp/token';
const REVOKE_PATH = '/api/auth/mcp/revoke';

export const DEFAULT_SCOPE = 'memory:read memory:write offline_access';

export const pkcePair = (): PkcePair => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

export const randomState = (): string => randomBytes(16).toString('base64url');

export const registerClient = async (authUrl: string, redirectUri: string): Promise<string> => {
  const res = await fetch(`${authUrl}${REGISTER_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cliHeaders() },
    body: JSON.stringify({
      client_name: 'agentage CLI',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!res.ok) throw new Error(`client registration failed (${res.status})`);
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error('client registration returned no client_id');
  return body.client_id;
};

export const buildAuthorizeUrl = (
  authUrl: string,
  params: {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string;
    scope?: string;
  }
): string => {
  const url = new URL(`${authUrl}${AUTHORIZE_PATH}`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  return url.toString();
};

// A token-endpoint failure that carries the HTTP status and any RFC 6749 `error` code so the
// caller can tell a dead grant (invalid_grant/invalid_client/401) from a transient blip (429/5xx).
export class TokenRequestError extends Error {
  constructor(
    readonly status: number,
    readonly oauthError?: string
  ) {
    super(`token request failed (${status}${oauthError ? ` ${oauthError}` : ''})`);
    this.name = 'TokenRequestError';
  }
}

const postForm = async (url: string, form: Record<string, string>): Promise<TokenResponse> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...cliHeaders() },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new TokenRequestError(res.status, body?.error);
  }
  return (await res.json()) as TokenResponse;
};

export const exchangeCode = (
  authUrl: string,
  params: { clientId: string; code: string; redirectUri: string; verifier: string }
): Promise<TokenResponse> =>
  postForm(`${authUrl}${TOKEN_PATH}`, {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.verifier,
  });

export const refreshTokens = (
  authUrl: string,
  clientId: string,
  refreshToken: string
): Promise<TokenResponse> =>
  postForm(`${authUrl}${TOKEN_PATH}`, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

// AbortSignal.timeout caps a stalled revoke on a packet-drop network; residual undici keepalive is
// acceptable here since --disconnect exits right after and errors are swallowed anyway.
export const revokeToken = async (
  authUrl: string,
  token: string,
  timeoutMs = 3000
): Promise<void> => {
  try {
    await fetch(`${authUrl}${REVOKE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...cliHeaders() },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // best-effort: local credentials are removed regardless
  }
};
