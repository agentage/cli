import * as configUtils from '../utils/config.js';
import {
  AuthError,
  getMe,
  logout,
  pollForToken,
  requestDeviceCode,
} from './auth.service.js';

// Mock the config utils
jest.mock('../utils/config.js');

const mockGetRegistryUrl = configUtils.getRegistryUrl as jest.MockedFunction<
  typeof configUtils.getRegistryUrl
>;
const mockGetAuthToken = configUtils.getAuthToken as jest.MockedFunction<
  typeof configUtils.getAuthToken
>;
const mockGetDeviceId = configUtils.getDeviceId as jest.MockedFunction<
  typeof configUtils.getDeviceId
>;

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('auth.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRegistryUrl.mockResolvedValue('https://dev.agentage.io');
    mockGetDeviceId.mockResolvedValue('test-device-id-12345678');
  });

  describe('requestDeviceCode', () => {
    it('returns device code response on success', async () => {
      const deviceCodeResponse = {
        device_code: 'abc123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://dev.agentage.io/device',
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(deviceCodeResponse),
      });

      const result = await requestDeviceCode();

      expect(result).toEqual(deviceCodeResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.agentage.io/api/auth/device/code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: 'test-device-id-12345678' }),
        }
      );
    });

    it('throws AuthError on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'server_error',
            error_description: 'Something went wrong',
          }),
      });

      await expect(requestDeviceCode()).rejects.toThrow(AuthError);
      await expect(requestDeviceCode()).rejects.toThrow('Something went wrong');
    });
  });

  describe('pollForToken', () => {
    it('returns token on successful authentication', async () => {
      const tokenResponse = {
        access_token: 'token123',
        token_type: 'Bearer',
        user: { id: '1', email: 'test@example.com' },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

      // Use very short interval for testing (0.01 seconds)
      const result = await pollForToken('device123', 0.01, 60);

      expect(result).toEqual(tokenResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.agentage.io/api/auth/device/token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ device_code: 'device123' }),
        })
      );
    });

    it('throws on access_denied', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'access_denied' }),
      });

      await expect(pollForToken('device123', 0.01, 60)).rejects.toThrow(
        'Authorization was denied'
      );
    });

    it('throws on expired_token', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'expired_token' }),
      });

      await expect(pollForToken('device123', 0.01, 60)).rejects.toThrow(
        'Login timed out'
      );
    });

    it('continues polling on authorization_pending then succeeds', async () => {
      const tokenResponse = {
        access_token: 'token123',
        token_type: 'Bearer',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'authorization_pending' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(tokenResponse),
        });

      const result = await pollForToken('device123', 0.01, 60);

      expect(result).toEqual(tokenResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('slows down polling on slow_down error', async () => {
      const tokenResponse = {
        access_token: 'token123',
        token_type: 'Bearer',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'slow_down' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(tokenResponse),
        });

      // Note: slow_down adds 5 seconds, but with 0.01 initial interval
      // it should still complete reasonably fast for testing
      const result = await pollForToken('device123', 0.001, 60);

      expect(result).toEqual(tokenResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000); // Increase timeout for this test

    it('throws on unknown error with description', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'unknown_error',
            error_description: 'Something unexpected happened',
          }),
      });

      await expect(pollForToken('device123', 0.01, 60)).rejects.toThrow(
        'Something unexpected happened'
      );
    });

    it('throws on unknown error without description', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'some_error' }),
      });

      await expect(pollForToken('device123', 0.01, 60)).rejects.toThrow(
        'Authentication failed'
      );
    });
  });

  describe('getMe', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('returns user on success', async () => {
      const user = { id: '1', email: 'test@example.com', name: 'Test User' };
      mockGetAuthToken.mockResolvedValue('token123');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user }),
      });

      const result = await getMe();

      expect(result).toEqual(user);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.agentage.io/api/auth/me',
        {
          headers: { Authorization: 'Bearer token123' },
        }
      );
    });

    it('throws when not authenticated', async () => {
      mockGetAuthToken.mockResolvedValue(undefined);

      await expect(getMe()).rejects.toThrow('Not authenticated');
    });

    it('throws on session expired (401)', async () => {
      mockGetAuthToken.mockResolvedValue('expired-token');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      await expect(getMe()).rejects.toThrow('Session expired');
    });

    it('throws on other API errors with description', async () => {
      mockGetAuthToken.mockResolvedValue('token123');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: 'server_error',
            error_description: 'Internal server error',
          }),
      });

      await expect(getMe()).rejects.toThrow('Internal server error');
    });

    it('throws on other API errors without description', async () => {
      mockGetAuthToken.mockResolvedValue('token123');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'server_error' }),
      });

      await expect(getMe()).rejects.toThrow('Failed to get user info');
    });
  });

  describe('logout', () => {
    it('calls logout endpoint when authenticated', async () => {
      mockGetAuthToken.mockResolvedValue('token123');
      mockFetch.mockResolvedValue({ ok: true });

      await logout();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.agentage.io/api/auth/logout',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer token123' },
        }
      );
    });

    it('does nothing when not authenticated', async () => {
      mockGetAuthToken.mockResolvedValue(undefined);

      await logout();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('ignores fetch errors', async () => {
      mockGetAuthToken.mockResolvedValue('token123');
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(logout()).resolves.not.toThrow();
    });
  });

  describe('AuthError', () => {
    it('has correct name and code', () => {
      const error = new AuthError('Test message', 'test_code');

      expect(error.name).toBe('AuthError');
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('test_code');
    });
  });
});
