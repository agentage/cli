import { readAuth, saveAuth, type AuthState } from './auth.js';
import { logInfo, logWarn } from '../daemon/logger.js';

const TOKEN_REFRESH_THRESHOLD_S = 300; // 5 minutes

export type RefreshResult = { ok: true } | { ok: false; terminal: boolean; reason: string };

export class AuthExpiredError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Auth expired (${reason}). Run 'agentage setup --reauth' to reconnect.`);
    this.name = 'AuthExpiredError';
    this.reason = reason;
  }
}

// HTTP status codes from the Supabase token endpoint that indicate the
// refresh_token itself is invalid/revoked — non-recoverable without re-auth.
// 408/429/5xx are transient and should keep retrying.
export const isTerminalRefreshStatus = (status: number): boolean => {
  if (status === 408 || status === 429) return false;
  if (status >= 500) return false;
  return status >= 400;
};

export const isTokenExpiringSoon = (auth: AuthState): boolean => {
  if (!auth.session.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return auth.session.expires_at - now < TOKEN_REFRESH_THRESHOLD_S;
};

export const refreshTokenIfNeeded = async (): Promise<RefreshResult> => {
  const auth = readAuth();
  if (!auth) return { ok: true };

  if (!isTokenExpiringSoon(auth)) return { ok: true };

  if (!auth.session.refresh_token) {
    logWarn('[token-refresh] Token expiring soon but no refresh token available');
    return { ok: false, terminal: true, reason: 'no_refresh_token' };
  }

  logInfo('[token-refresh] Token expiring soon, refreshing...');

  try {
    const healthRes = await fetch(`${auth.hub.url}/api/health`);
    const health = (await healthRes.json()) as {
      success: boolean;
      data: { supabaseUrl: string; supabaseAnonKey: string };
    };

    const res = await fetch(`${health.data.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: health.data.supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: auth.session.refresh_token }),
    });

    if (!res.ok) {
      const terminal = isTerminalRefreshStatus(res.status);
      logWarn(`[token-refresh] Refresh request failed with status ${res.status}`);
      return { ok: false, terminal, reason: `status_${res.status}` };
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };

    auth.session.access_token = data.access_token;
    auth.session.refresh_token = data.refresh_token;
    auth.session.expires_at = data.expires_at;
    saveAuth(auth);

    logInfo('[token-refresh] Token refreshed successfully');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(`[token-refresh] Failed: ${message}`);
    return { ok: false, terminal: false, reason: `network: ${message}` };
  }
};
