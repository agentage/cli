import {
  AuthErrorResponse,
  DeviceCodeResponse,
  TokenResponse,
  User,
} from '../types/config.types.js';
import { getAuthToken, getDeviceId, getRegistryUrl } from '../utils/config.js';

/**
 * Auth error class
 */
export class AuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Request a device code for authentication
 */
export const requestDeviceCode = async (): Promise<DeviceCodeResponse> => {
  const registryUrl = await getRegistryUrl();
  const deviceId = await getDeviceId();

  const response = await fetch(`${registryUrl}/api/auth/device/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_id: deviceId }),
  });

  if (!response.ok) {
    const error = (await response.json()) as AuthErrorResponse;
    throw new AuthError(
      error.error_description || 'Failed to request device code',
      error.error || 'request_failed'
    );
  }

  return response.json() as Promise<DeviceCodeResponse>;
};

/**
 * Poll for token after user completes authentication
 */
export const pollForToken = async (
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<TokenResponse> => {
  const registryUrl = await getRegistryUrl();
  const startTime = Date.now();
  const expiryTime = startTime + expiresIn * 1000;
  let currentInterval = interval;

  while (Date.now() < expiryTime) {
    // Wait for the specified interval
    await sleep(currentInterval * 1000);

    const response = await fetch(`${registryUrl}/api/auth/device/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    if (response.ok) {
      return response.json() as Promise<TokenResponse>;
    }

    const error = (await response.json()) as AuthErrorResponse;

    switch (error.error) {
      case 'authorization_pending':
        // User hasn't completed auth yet, continue polling
        continue;
      case 'slow_down':
        // Increase polling interval
        currentInterval += 5;
        continue;
      case 'expired_token':
        throw new AuthError('Login timed out. Please try again.', error.error);
      case 'access_denied':
        throw new AuthError('Authorization was denied.', error.error);
      default:
        throw new AuthError(
          error.error_description || 'Authentication failed',
          error.error || 'unknown_error'
        );
    }
  }

  throw new AuthError('Login timed out. Please try again.', 'expired_token');
};

/**
 * API response for /api/auth/me endpoint
 */
interface MeResponse {
  user: User;
}

/**
 * Get the current authenticated user
 */
export const getMe = async (): Promise<User> => {
  const registryUrl = await getRegistryUrl();
  const token = await getAuthToken();

  if (!token) {
    throw new AuthError('Not authenticated', 'not_authenticated');
  }

  const response = await fetch(`${registryUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthError(
        'Session expired. Please login again.',
        'session_expired'
      );
    }
    const error = (await response.json()) as AuthErrorResponse;
    throw new AuthError(
      error.error_description || 'Failed to get user info',
      error.error || 'request_failed'
    );
  }

  const data = (await response.json()) as MeResponse;
  return data.user;
};

/**
 * Invalidate the current session (optional server-side logout)
 */
export const logout = async (): Promise<void> => {
  const registryUrl = await getRegistryUrl();
  const token = await getAuthToken();

  if (!token) {
    return; // Already logged out
  }

  try {
    await fetch(`${registryUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Ignore errors - local logout will still work
  }
};

/**
 * Sleep utility
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
