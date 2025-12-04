import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import type { AgentageConfig } from '../types/config.types.js';
import {
  clearConfig,
  DEFAULT_REGISTRY_URL,
  getAuthStatus,
  getAuthToken,
  getConfigDir,
  getConfigPath,
  getDeviceId,
  getRegistryUrl,
  isTokenExpired,
  loadConfig,
  saveConfig,
} from './config.js';

// Mock fs/promises
jest.mock('fs/promises');
jest.mock('os');

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockRm = rm as jest.MockedFunction<typeof rm>;
const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;

describe('config utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHomedir.mockReturnValue('/home/testuser');
    // Clear environment variables
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

  describe('loadConfig', () => {
    it('returns parsed config when file exists', async () => {
      const config: AgentageConfig = {
        auth: {
          token: 'test-token',
          user: { id: '123', email: 'test@example.com' },
        },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await loadConfig();

      expect(result).toEqual(config);
      expect(mockReadFile).toHaveBeenCalledWith(
        '/home/testuser/.agentage/config.json',
        'utf-8'
      );
    });

    it('returns empty config when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await loadConfig();

      expect(result).toEqual({});
    });

    it('returns empty config when file contains invalid JSON', async () => {
      mockReadFile.mockResolvedValue('invalid json');

      const result = await loadConfig();

      expect(result).toEqual({});
    });
  });

  describe('saveConfig', () => {
    it('creates directory and writes config file', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const config: AgentageConfig = {
        auth: { token: 'test-token' },
      };

      await saveConfig(config);

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

  describe('clearConfig', () => {
    it('removes the config file', async () => {
      mockRm.mockResolvedValue(undefined);

      await clearConfig();

      expect(mockRm).toHaveBeenCalledWith(
        '/home/testuser/.agentage/config.json'
      );
    });

    it('ignores error if file does not exist', async () => {
      mockRm.mockRejectedValue(new Error('ENOENT'));

      await expect(clearConfig()).resolves.not.toThrow();
    });
  });

  describe('getRegistryUrl', () => {
    it('returns environment variable when set', async () => {
      process.env.AGENTAGE_REGISTRY_URL = 'https://custom.registry.io';

      const result = await getRegistryUrl();

      expect(result).toBe('https://custom.registry.io');
    });

    it('returns config value when no env var', async () => {
      const config: AgentageConfig = {
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

    it('returns config value when no env var', async () => {
      const config: AgentageConfig = {
        auth: { token: 'config-token' },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getAuthToken();

      expect(result).toBe('config-token');
    });

    it('returns undefined when no token available', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await getAuthToken();

      expect(result).toBeUndefined();
    });

    it('returns undefined when token is expired', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
      const config: AgentageConfig = {
        auth: { token: 'expired-token', expiresAt: pastDate },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getAuthToken();

      expect(result).toBeUndefined();
    });

    it('returns token when not expired', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
      const config: AgentageConfig = {
        auth: { token: 'valid-token', expiresAt: futureDate },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

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
      const config: AgentageConfig = {
        auth: { token: 'expired-token', expiresAt: pastDate },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getAuthStatus();

      expect(result).toEqual({ status: 'expired' });
    });

    it('returns authenticated when token is valid', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const config: AgentageConfig = {
        auth: { token: 'valid-token', expiresAt: futureDate },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getAuthStatus();

      expect(result).toEqual({ status: 'authenticated', token: 'valid-token' });
    });
  });

  describe('getDeviceId', () => {
    it('returns existing device ID from config', async () => {
      const config: AgentageConfig = {
        deviceId: 'existing-device-id-12345678',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getDeviceId();

      expect(result).toBe('existing-device-id-12345678');
      // Should not save config since device ID already exists
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('generates and saves new device ID when not in config', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await getDeviceId();

      // Should return a 32-character hex string
      expect(result).toMatch(/^[a-f0-9]{32}$/);
      // Should save the new device ID
      expect(mockWriteFile).toHaveBeenCalled();
      const savedConfig = JSON.parse(
        mockWriteFile.mock.calls[0][1] as string
      ) as AgentageConfig;
      expect(savedConfig.deviceId).toBe(result);
    });

    it('returns consistent device ID on subsequent calls', async () => {
      const config: AgentageConfig = {
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
