import { z } from 'zod';

/**
 * User information schema
 */
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  avatar: z.string().optional(),
  verifiedAlias: z.string().optional(),
});

/**
 * Auth config schema (auth.json)
 */
export const authFileSchema = z.object({
  token: z.string().optional(),
  expiresAt: z.string().optional(),
  user: userSchema.optional(),
});

/**
 * Registry configuration schema
 */
export const registryConfigSchema = z.object({
  url: z.url().default('https://dev.agentage.io'),
});

/**
 * App config schema (config.json) — NO tokens
 */
export const appConfigSchema = z.object({
  registry: registryConfigSchema.optional(),
  deviceId: z.string().optional(),
});

/**
 * User information from the API
 */
export type User = z.infer<typeof userSchema>;

/**
 * Auth config (auth.json)
 */
export type AuthFileConfig = z.infer<typeof authFileSchema>;

/**
 * Registry configuration
 */
export type RegistryConfig = z.infer<typeof registryConfigSchema>;

/**
 * App configuration (config.json — no tokens)
 */
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Device code response from the auth API
 */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Token response from the auth API
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  user?: User;
}

/**
 * Auth error response
 */
export interface AuthErrorResponse {
  error: string;
  error_description?: string;
}
