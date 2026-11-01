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
  // 0 until answered; stays 0 for a request the site never answers.
  status: number;
  grantType?: string;
  // The account routes (/v1/...): their precondition headers and JSON body.
  ifMatch?: string;
  ifNoneMatch?: string;
  body?: unknown;
}

// The account's profile as stored: the last accepted push and its ETag.
export interface StubProfile {
  version: number;
  profile: Record<string, unknown>;
  lock: Record<string, unknown> | null;
  npmMajor: number | null;
  updatedAt: string;
  etag: string;
}

export interface StubMachine {
  id: string;
  name: string;
  platform: string;
  cliVersion: string;
  managed: boolean;
  state: 'connected' | 'disconnected';
  firstSeenAt: string;
  lastSeenAt: string;
}

// '503' answers every request to the route with 503; 'hang' never answers; 'missing' answers
// 404 NOT_FOUND, as an API that does not have the route yet.
export type StubMode = 'ok' | '503' | 'hang' | 'missing';

// The one account every stub token belongs to: its profile and its machines.
export interface StubAccount {
  // null: no profile yet, so GET answers 404.
  profile: StubProfile | null;
  // Each next PUT first meets one of these: another machine's push changing the stored profile.
  conflicts: ((profile: Record<string, unknown>) => Record<string, unknown>)[];
  modes: { profile: StubMode; machines: StubMode };
  machines: Map<string, StubMachine>;
}

export interface StubState extends Required<StubOptions> {
  // client_id -> registered redirect_uris
  clients: Map<string, string[]>;
  codes: StubCode[];
  tokens: StubToken[];
  revocations: string[];
  requests: StubRequest[];
  account: StubAccount;
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
  account: {
    profile: null,
    conflicts: [],
    modes: { profile: 'ok', machines: 'ok' },
    machines: new Map(),
  },
});

export const mint = (prefix: string): string => `${prefix}_${randomBytes(16).toString('hex')}`;

// A strong, opaque ETag, fresh on every accepted write.
export const mintEtag = (): string => `"${randomBytes(12).toString('base64url')}"`;

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
