// Auth failures split two ways: TERMINAL means the session truly needs re-auth (401,
// invalid_grant/invalid_client on the refresh grant); TRANSIENT means a blip we must not report as
// expired (429, 5xx, network, timeout, unexpected redirect). Mirrors web#219's get-session taxonomy.

// The session is genuinely gone: user must sign in again.
export class AuthRequiredError extends Error {
  constructor(message = 'not signed in') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

// A temporary failure (rate limit / server hiccup / network) - the session may still be valid.
export class TransientAuthError extends Error {
  constructor(message = 'could not verify session') {
    super(message);
    this.name = 'TransientAuthError';
  }
}

// OAuth token-endpoint error codes that mean the refresh grant is dead, not merely throttled.
const TERMINAL_GRANT_ERRORS = new Set(['invalid_grant', 'invalid_client']);

// Classify a failed refresh POST: 401 or an explicit invalid_grant/invalid_client is terminal;
// everything else (429, 5xx, network, redirect, unknown) is transient.
export const isTerminalRefresh = (status: number, oauthError?: string): boolean =>
  status === 401 || (oauthError !== undefined && TERMINAL_GRANT_ERRORS.has(oauthError));
