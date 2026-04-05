import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./auth.js', () => ({
  readAuth: vi.fn(),
  saveAuth: vi.fn(),
}));

vi.mock('../daemon/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { readAuth, saveAuth, type AuthState } from './auth.js';
import { logWarn } from '../daemon/logger.js';
import { isTokenExpiringSoon, refreshTokenIfNeeded } from './token-refresh.js';

const mockReadAuth = vi.mocked(readAuth);
const mockSaveAuth = vi.mocked(saveAuth);
const mockLogWarn = vi.mocked(logWarn);

const nowSecs = () => Math.floor(Date.now() / 1000);

const makeAuth = (overrides: Partial<AuthState['session']> = {}): AuthState => ({
  session: {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: nowSecs() + 600,
    ...overrides,
  },
  user: { id: 'user-1', email: 'test@example.com' },
  hub: { url: 'https://hub.example.com', machineId: 'machine-1' },
});

describe('isTokenExpiringSoon', () => {
  it('returns false when expires_at is 0', () => {
    const auth = makeAuth({ expires_at: 0 });
    expect(isTokenExpiringSoon(auth)).toBe(false);
  });

  it('returns false when token expires in more than 300 seconds', () => {
    const auth = makeAuth({ expires_at: nowSecs() + 600 });
    expect(isTokenExpiringSoon(auth)).toBe(false);
  });

  it('returns true when token expires in less than 300 seconds', () => {
    const auth = makeAuth({ expires_at: nowSecs() + 100 });
    expect(isTokenExpiringSoon(auth)).toBe(true);
  });

  it('returns true when token is already expired', () => {
    const auth = makeAuth({ expires_at: nowSecs() - 60 });
    expect(isTokenExpiringSoon(auth)).toBe(true);
  });

  it('boundary: exactly 300 seconds from now returns false', () => {
    // expires_at - now === 300, which is NOT < 300, so returns false
    const auth = makeAuth({ expires_at: nowSecs() + 300 });
    expect(isTokenExpiringSoon(auth)).toBe(false);
  });
});

describe('refreshTokenIfNeeded', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns early when readAuth returns null', async () => {
    mockReadAuth.mockReturnValue(null);

    await refreshTokenIfNeeded();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns early when token is not expiring soon', async () => {
    mockReadAuth.mockReturnValue(makeAuth({ expires_at: nowSecs() + 600 }));

    await refreshTokenIfNeeded();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('warns and returns when expiring soon but refresh_token is missing', async () => {
    mockReadAuth.mockReturnValue(makeAuth({ expires_at: nowSecs() + 100, refresh_token: '' }));

    await refreshTokenIfNeeded();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('no refresh token available'));
  });

  it('happy path: fetches health then refreshes token and saves auth', async () => {
    const auth = makeAuth({ expires_at: nowSecs() + 100 });
    mockReadAuth.mockReturnValue(auth);

    const supabaseUrl = 'https://supabase.example.com';
    const supabaseAnonKey = 'anon-key';

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { supabaseUrl, supabaseAnonKey },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_at: nowSecs() + 3600,
        }),
      });

    await refreshTokenIfNeeded();

    expect(mockFetch).toHaveBeenNthCalledWith(1, `${auth.hub.url}/api/health`);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: supabaseAnonKey }),
        body: JSON.stringify({ refresh_token: 'refresh-token' }),
      })
    );
    expect(mockSaveAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
        }),
      })
    );
  });

  it('returns without crashing when health fetch throws', async () => {
    mockReadAuth.mockReturnValue(makeAuth({ expires_at: nowSecs() + 100 }));

    mockFetch.mockRejectedValueOnce(new Error('network error'));

    await expect(refreshTokenIfNeeded()).resolves.toBeUndefined();
    expect(mockSaveAuth).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('network error'));
  });

  it('logs warning and returns when token endpoint returns non-ok', async () => {
    const auth = makeAuth({ expires_at: nowSecs() + 100 });
    mockReadAuth.mockReturnValue(auth);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            supabaseUrl: 'https://supabase.example.com',
            supabaseAnonKey: 'anon-key',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

    await refreshTokenIfNeeded();

    expect(mockSaveAuth).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('catches and logs network errors without crashing', async () => {
    mockReadAuth.mockReturnValue(makeAuth({ expires_at: nowSecs() + 100 }));

    mockFetch.mockRejectedValue(new Error('connection refused'));

    await expect(refreshTokenIfNeeded()).resolves.toBeUndefined();
    expect(mockSaveAuth).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
  });

  it('catches and logs non-Error thrown values without crashing', async () => {
    mockReadAuth.mockReturnValue(makeAuth({ expires_at: nowSecs() + 100 }));

    mockFetch.mockRejectedValue('string error');

    await expect(refreshTokenIfNeeded()).resolves.toBeUndefined();
    expect(mockSaveAuth).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('string error'));
  });
});
