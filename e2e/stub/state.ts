import { randomBytes } from 'node:crypto';

export interface StubOptions {
  // Access-token lifetime in seconds; 0 omits `expires_in`, so the CLI holds no expiry of its own.
  expiresIn?: number;
  // Answer get-session with a 503 this many times before serving it normally.
  transientGetSession?: number;
  denyAuthorize?: boolean;
}

export interface StubCode {
  code: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  used: boolean;
}

export interface StubToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  scope: string;
  // Epoch ms; null for a grant issued with `expiresIn: 0`.
  expiresAt: number | null;
  rotated: boolean;
  revoked: boolean;
}

export interface StubRequest {
  method: string;
  path: string;
  status: number;
  grantType?: string;
}

export interface StubState extends Required<StubOptions> {
  // client_id -> registered redirect_uris
  clients: Map<string, string[]>;
  codes: StubCode[];
  tokens: StubToken[];
  revocations: string[];
  requests: StubRequest[];
}

export const STUB_USER_ID = 'stub-user';

export const createState = (opts: StubOptions = {}): StubState => ({
  expiresIn: opts.expiresIn ?? 3600,
  transientGetSession: opts.transientGetSession ?? 0,
  denyAuthorize: opts.denyAuthorize ?? false,
  clients: new Map(),
  codes: [],
  tokens: [],
  revocations: [],
  requests: [],
});

export const mint = (prefix: string): string => `${prefix}_${randomBytes(16).toString('hex')}`;

export const issueToken = (state: StubState, clientId: string, scope: string): StubToken => {
  const token: StubToken = {
    accessToken: mint('at'),
    refreshToken: mint('rt'),
    clientId,
    scope,
    expiresAt: state.expiresIn > 0 ? Date.now() + state.expiresIn * 1000 : null,
    rotated: false,
    revoked: false,
  };
  state.tokens.push(token);
  return token;
};

const unexpired = (token: StubToken): boolean =>
  token.expiresAt === null || token.expiresAt > Date.now();

export const liveAccess = (state: StubState, accessToken: string): StubToken | undefined =>
  state.tokens.find((t) => t.accessToken === accessToken && !t.revoked && unexpired(t));

// A rotated or revoked refresh token is dead: replaying it is an invalid_grant.
export const liveRefresh = (state: StubState, refreshToken: string): StubToken | undefined =>
  state.tokens.find((t) => t.refreshToken === refreshToken && !t.revoked && !t.rotated);
