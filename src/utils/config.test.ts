import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import type { AppConfig, AuthFileConfig } from '../types/config.types.js';
import {
  clearAuth,
  DEFAULT_REGISTRY_URL,
  getAuthPath,
  getAuthStatus,
  getAuthToken,
  getConfigDir,
  getConfigPath,
  getDeviceId,
  getRegistryUrl,
  isTokenExpired,
  loadAppConfig,
  loadAuth,
  saveAppConfig,
  saveAuth,
} from './config.js';

// Mock fs/promises
jest.mock('fs/promises');
jest.mock('os');

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;

describe('config utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHomedir.mockReturnValue('/home/testuser');
    delete process.env.AGENTAGE_REGISTRY_URL;
    delete process.env.AGENTAGE_AUTH_TOKEN;
  });

  describe('getConfigDir', () => {
    it('returns the correct config directory path', () => {
      expect(getConfigDir()).toBe('/home/testuser/.agentage');
    });
  });

  describe('getConfigPath', () => {
    it('returns the correct config file path', () => {
      expect(getConfigPath()).toBe('/home/testuser/.agentage/config.json');
    });
  });

  describe('getAuthPath', () => {
    it('returns the correct auth file path', () => {
      expect(getAuthPath()).toBe('/home/testuser/.agentage/auth.json');
    });
  });

  describe('loadAuth', () => {
    it('returns parsed auth when file exists', async () => {
      const auth: AuthFileConfig = {
        token: 'test-token',
        expiresAt: '2030-01-01T00:00:00.000Z',
        user: { id: '123', email: 'test@example.com' },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(auth));

      const result = await loadAuth();

      expect(result).toEqual(auth);
      expect(mockReadFile).toHaveBeenCalledWith(
        '/home/testuser/.agentage/auth.json',
        'utf-8'
      );
    });

    it('returns empty object when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await loadAuth();

      expect(result).toEqual({});
    });

    it('returns empty object when file contains invalid JSON', async () => {
      mockReadFile.mockResolvedValue('not json');

      const result = await loadAuth();

      expect(result).toEqual({});
    });
  });

  describe('saveAuth', () => {
    it('creates directory and writes auth.json', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const auth: AuthFileConfig = {
        token: 'my-token',
        user: { id: '1', email: 'a@b.com' },
      };

      await saveAuth(auth);

      expect(mockMkdir).toHaveBeenCalledWith('/home/testuser/.agentage', {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/testuser/.agentage/auth.json',
        JSON.stringify(auth, null, 2),
        'utf-8'
      );
    });
  });

  describe('clearAuth', () => {
    it('writes empty object to auth.json', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      await clearAuth();

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/testuser/.agentage/auth.json',
        JSON.stringify({}, null, 2),
        'utf-8'
      );
    });

    it('does not touch config.json', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      await clearAuth();

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writtenPath = mockWriteFile.mock.calls[0][0] as string;
      expect(writtenPath).toContain('auth.json');
      expect(writtenPath).not.toContain('config.json');
    });

    it('ignores errors gracefully', async () => {
      mockWriteFile.mockRejectedValue(new Error('ENOENT'));

      await expect(clearAuth()).resolves.not.toThrow();
    });
  });

  describe('loadAppConfig', () => {
    it('returns parsed app config when file exists', async () => {
      const config: AppConfig = {
        registry: { url: 'https://agentage.io' },
        deviceId: 'abc123',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await loadAppConfig();

      expect(result).toEqual(config);
      expect(mockReadFile).toHaveBeenCalledWith(
        '/home/testuser/.agentage/config.json',
        'utf-8'
      );
    });

    it('returns empty object when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await loadAppConfig();

      expect(result).toEqual({});
    });

    it('strips unknown fields from config.json', async () => {
      const configWithExtra = {
        auth: { token: 'should-be-ignored' },
        registry: { url: 'https://agentage.io' },
        deviceId: 'abc123',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(configWithExtra));

      const result = await loadAppConfig();

      expect(result).toEqual({
        registry: { url: 'https://agentage.io' },
        deviceId: 'abc123',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).auth).toBeUndefined();
    });
  });

  describe('saveAppConfig', () => {
    it('creates directory and writes config.json', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const config: AppConfig = {
        registry: { url: 'https://agentage.io' },
        deviceId: 'dev-123',
      };

      await saveAppConfig(config);

      expect(mockMkdir).toHaveBeenCalledWith('/home/testuser/.agentage', {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/testuser/.agentage/config.json',
        JSON.stringify(config, null, 2),
        'utf-8'
      );
    });
  });

  describe('getRegistryUrl', () => {
    it('returns environment variable when set', async () => {
      process.env.AGENTAGE_REGISTRY_URL = 'https://custom.registry.io';

      const result = await getRegistryUrl();

      expect(result).toBe('https://custom.registry.io');
    });

    it('returns config value when no env var', async () => {
      const config: AppConfig = {
        registry: { url: 'https://config.registry.io' },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getRegistryUrl();

      expect(result).toBe('https://config.registry.io');
    });

    it('returns default when no env var or config', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await getRegistryUrl();

      expect(result).toBe(DEFAULT_REGISTRY_URL);
    });
  });

  describe('getAuthToken', () => {
    it('returns environment variable when set', async () => {
      process.env.AGENTAGE_AUTH_TOKEN = 'env-token';

      const result = await getAuthToken();

      expect(result).toBe('env-token');
    });

    it('returns token from auth.json when no env var', async () => {
      const auth: AuthFileConfig = { token: 'auth-file-token' };
      mockReadFile.mockResolvedValue(JSON.stringify(auth));

      const result = await getAuthToken();

      expect(result).toBe('auth-file-token');
    });

    it('returns undefined when no token available', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await getAuthToken();

      expect(result).toBeUndefined();
    });

    it('returns undefined when token is expired', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const auth: AuthFileConfig = {
        token: 'expired-token',
        expiresAt: pastDate,
      };
      mockReadFile.mockResolvedValue(JSON.stringify(auth));

      const result = await getAuthToken();

      expect(result).toBeUndefined();
    });

    it('returns token when not expired', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const auth: AuthFileConfig = {
        token: 'valid-token',
        expiresAt: futureDate,
      };
      mockReadFile.mockResolvedValue(JSON.stringify(auth));

      const result = await getAuthToken();

      expect(result).toBe('valid-token');
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when expiresAt is undefined', () => {
      expect(isTokenExpired(undefined)).toBe(false);
    });

    it('returns true when token is expired', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      expect(isTokenExpired(pastDate)).toBe(true);
    });

    it('returns false when token is not expired', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      expect(isTokenExpired(futureDate)).toBe(false);
    });

    it('returns true when token just expired', () => {
      const now = new Date().toISOString();
      expect(isTokenExpired(now)).toBe(true);
    });
  });

  describe('getAuthStatus', () => {
    it('returns authenticated with env token', async () => {
      process.env.AGENTAGE_AUTH_TOKEN = 'env-token';

      const result = await getAuthStatus();

      expect(result).toEqual({ status: 'authenticated', token: 'env-token' });
    });

    it('returns not_authenticated when no token', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await getAuthStatus();

      expect(result).toEqual({ status: 'not_authenticated' });
    });

    it('returns expired when token is expired', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const auth: AuthFileConfig = {
        token: 'expired-token',
        expiresAt: pastDate,
      };
      mockReadFile.mockResolvedValue(JSON.stringify(auth));

      const result = await getAuthStatus();

      expect(result).toEqual({ status: 'expired' });
    });

    it('returns authenticated when token is valid', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const auth: AuthFileConfig = {
        token: 'valid-token',
        expiresAt: futureDate,
      };
      mockReadFile.mockResolvedValue(JSON.stringify(auth));

      const result = await getAuthStatus();

      expect(result).toEqual({ status: 'authenticated', token: 'valid-token' });
    });
  });

  describe('getDeviceId', () => {
    it('returns existing device ID from config.json', async () => {
      const config: AppConfig = {
        deviceId: 'existing-device-id-12345678',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getDeviceId();

      expect(result).toBe('existing-device-id-12345678');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('generates and saves new device ID when not in config', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await getDeviceId();

      expect(result).toMatch(/^[a-f0-9]{32}$/);
      expect(mockWriteFile).toHaveBeenCalled();
      const writtenPath = mockWriteFile.mock.calls[0][0] as string;
      expect(writtenPath).toContain('config.json');
      const savedConfig = JSON.parse(
        mockWriteFile.mock.calls[0][1] as string
      ) as AppConfig;
      expect(savedConfig.deviceId).toBe(result);
    });

    it('returns consistent device ID on subsequent calls', async () => {
      const config: AppConfig = {
        deviceId: 'consistent-device-id-abc',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result1 = await getDeviceId();
      const result2 = await getDeviceId();

      expect(result1).toBe(result2);
      expect(result1).toBe('consistent-device-id-abc');
    });
  });
});
