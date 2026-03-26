import { readAuth, saveAuth, type AuthState } from './auth.js';
import { logInfo, logWarn } from '../daemon/logger.js';

const TOKEN_REFRESH_THRESHOLD_S = 300; // 5 minutes

export const isTokenExpiringSoon = (auth: AuthState): boolean => {
  if (!auth.session.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return auth.session.expires_at - now < TOKEN_REFRESH_THRESHOLD_S;
};

export const refreshTokenIfNeeded = async (): Promise<void> => {
  const auth = readAuth();
  if (!auth) return;

  if (!isTokenExpiringSoon(auth)) return;

  if (!auth.session.refresh_token) {
    logWarn('[token-refresh] Token expiring soon but no refresh token available');
    return;
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
      logWarn(`[token-refresh] Refresh request failed with status ${res.status}`);
      return;
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
  } catch (err) {
    logWarn(`[token-refresh] Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};
