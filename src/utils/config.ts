import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { arch, homedir, hostname, platform } from 'os';
import { dirname, join } from 'path';
import {
  AppConfig,
  appConfigSchema,
  AuthFileConfig,
  authFileSchema,
} from '../types/config.types.js';

/**
 * Default registry URL
 */
export const DEFAULT_REGISTRY_URL = 'https://dev.agentage.io';

/**
 * Get the config directory path
 */
export const getConfigDir = (): string => join(homedir(), '.agentage');

/**
 * Get the config file path (config.json)
 */
export const getConfigPath = (): string => join(getConfigDir(), 'config.json');

/**
 * Get the auth file path (auth.json)
 */
export const getAuthPath = (): string => join(getConfigDir(), 'auth.json');

/**
 * Load auth state from auth.json
 */
export const loadAuth = async (): Promise<AuthFileConfig> => {
  try {
    const authPath = getAuthPath();
    const content = await readFile(authPath, 'utf-8');
    const parsed = JSON.parse(content);
    return authFileSchema.parse(parsed);
  } catch {
    return {};
  }
};

/**
 * Save auth state to auth.json
 */
export const saveAuth = async (auth: AuthFileConfig): Promise<void> => {
  const authPath = getAuthPath();
  const authDir = dirname(authPath);
  await mkdir(authDir, { recursive: true });
  await writeFile(authPath, JSON.stringify(auth, null, 2), 'utf-8');
};

/**
 * Clear auth state (writes empty object to auth.json)
 * Does NOT touch config.json — deviceId and registry are preserved
 */
export const clearAuth = async (): Promise<void> => {
  try {
    const authPath = getAuthPath();
    await writeFile(authPath, JSON.stringify({}, null, 2), 'utf-8');
  } catch {
    // Ignore if directory doesn't exist
  }
};

/**
 * Load app config from config.json (registry + deviceId only, no tokens)
 */
export const loadAppConfig = async (): Promise<AppConfig> => {
  try {
    const configPath = getConfigPath();
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return appConfigSchema.parse(parsed);
  } catch {
    return {};
  }
};

/**
 * Save app config to config.json (registry + deviceId only)
 */
export const saveAppConfig = async (config: AppConfig): Promise<void> => {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
};

/**
 * Get the registry URL from config or environment
 */
export const getRegistryUrl = async (): Promise<string> => {
  // Environment variable takes precedence
  const envUrl = process.env.AGENTAGE_REGISTRY_URL;
  if (envUrl) {
    return envUrl;
  }

  const config = await loadAppConfig();
  return config.registry?.url || DEFAULT_REGISTRY_URL;
};

/**
 * Check if a token is expired
 */
export const isTokenExpired = (expiresAt: string | undefined): boolean => {
  if (!expiresAt) {
    return false; // No expiry means token doesn't expire
  }
  const expiryDate = new Date(expiresAt);
  return expiryDate <= new Date();
};

/**
 * Get the auth token from auth.json or environment
 * Returns undefined if the token is expired
 */
export const getAuthToken = async (): Promise<string | undefined> => {
  // Environment variable takes precedence
  const envToken = process.env.AGENTAGE_AUTH_TOKEN;
  if (envToken) {
    return envToken;
  }

  const auth = await loadAuth();

  if (auth.token) {
    if (isTokenExpired(auth.expiresAt)) {
      return undefined;
    }
    return auth.token;
  }

  return undefined;
};

/**
 * Auth status types
 */
export type AuthStatus =
  | { status: 'authenticated'; token: string }
  | { status: 'expired' }
  | { status: 'not_authenticated' };

/**
 * Get detailed auth status including whether token is expired
 */
export const getAuthStatus = async (): Promise<AuthStatus> => {
  // Environment variable takes precedence
  const envToken = process.env.AGENTAGE_AUTH_TOKEN;
  if (envToken) {
    return { status: 'authenticated', token: envToken };
  }

  const auth = await loadAuth();

  if (!auth.token) {
    return { status: 'not_authenticated' };
  }

  if (isTokenExpired(auth.expiresAt)) {
    return { status: 'expired' };
  }

  return { status: 'authenticated', token: auth.token };
};

/**
 * Generate a device fingerprint based on machine ID and OS info
 */
const generateDeviceFingerprint = async (): Promise<string> => {
  try {
    const { machineIdSync } = await import('node-machine-id');
    const machineId = machineIdSync();
    const osInfo = `${platform()}-${arch()}-${hostname()}`;
    const data = `${machineId}|${osInfo}`;
    return createHash('sha256').update(data).digest('hex').slice(0, 32);
  } catch {
    // Fallback if machine ID is not available
    const osInfo = `${platform()}-${arch()}-${hostname()}-${Date.now()}`;
    return createHash('sha256').update(osInfo).digest('hex').slice(0, 32);
  }
};

/**
 * Get or create a unique device ID
 * The device ID is generated from machine ID + OS info and stored in config.json
 */
export const getDeviceId = async (): Promise<string> => {
  const config = await loadAppConfig();

  if (config.deviceId) {
    return config.deviceId;
  }

  const deviceId = await generateDeviceFingerprint();
  await saveAppConfig({ ...config, deviceId });

  return deviceId;
};
