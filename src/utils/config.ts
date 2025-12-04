import { createHash } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { arch, homedir, hostname, platform } from 'os';
import { dirname, join } from 'path';
import { AgentageConfig, agentageConfigSchema } from '../types/config.types.js';

/**
 * Default registry URL
 */
export const DEFAULT_REGISTRY_URL = 'https://dev.agentage.io';

/**
 * Get the config directory path
 */
export const getConfigDir = (): string => join(homedir(), '.agentage');

/**
 * Get the config file path
 */
export const getConfigPath = (): string => join(getConfigDir(), 'config.json');

/**
 * Load configuration from disk
 */
export const loadConfig = async (): Promise<AgentageConfig> => {
  try {
    const configPath = getConfigPath();
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return agentageConfigSchema.parse(parsed);
  } catch {
    // Return empty config if file doesn't exist or is invalid
    return {};
  }
};

/**
 * Save configuration to disk
 */
export const saveConfig = async (config: AgentageConfig): Promise<void> => {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  // Ensure directory exists
  await mkdir(configDir, { recursive: true });

  // Write config file
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
};

/**
 * Clear stored credentials (logout)
 */
export const clearConfig = async (): Promise<void> => {
  try {
    const configPath = getConfigPath();
    await rm(configPath);
  } catch {
    // Ignore if file doesn't exist
  }
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

  // Check config file
  const config = await loadConfig();
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
 * Get the auth token from config or environment
 * Returns undefined if the token is expired
 */
export const getAuthToken = async (): Promise<string | undefined> => {
  // Environment variable takes precedence
  const envToken = process.env.AGENTAGE_AUTH_TOKEN;
  if (envToken) {
    return envToken;
  }

  // Check config file
  const config = await loadConfig();

  // Check if token exists and is not expired
  if (config.auth?.token) {
    if (isTokenExpired(config.auth.expiresAt)) {
      return undefined; // Token is expired
    }
    return config.auth.token;
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

  // Check config file
  const config = await loadConfig();

  if (!config.auth?.token) {
    return { status: 'not_authenticated' };
  }

  if (isTokenExpired(config.auth.expiresAt)) {
    return { status: 'expired' };
  }

  return { status: 'authenticated', token: config.auth.token };
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
 * The device ID is generated from machine ID + OS info and stored in config
 */
export const getDeviceId = async (): Promise<string> => {
  const config = await loadConfig();

  // Return existing device ID if available
  if (config.deviceId) {
    return config.deviceId;
  }

  // Generate and store new device ID
  const deviceId = await generateDeviceFingerprint();
  await saveConfig({ ...config, deviceId });

  return deviceId;
};
