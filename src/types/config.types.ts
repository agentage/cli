import { z } from 'zod';

/**
 * User information schema
 */
export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  avatar: z.string().url().optional(),
  verifiedAlias: z.string().optional(),
});

/**
 * Auth configuration schema
 */
export const authConfigSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime().optional(),
  user: userSchema.optional(),
});

/**
 * Registry configuration schema
 */
export const registryConfigSchema = z.object({
  url: z.string().url().default('https://dev.agentage.io'),
});

/**
 * Complete Agentage configuration schema
 */
export const agentageConfigSchema = z.object({
  auth: authConfigSchema.optional(),
  registry: registryConfigSchema.optional(),
  deviceId: z.string().optional(),
});

/**
 * User information from the API
 */
export type User = z.infer<typeof userSchema>;

/**
 * Auth configuration
 */
export type AuthConfig = z.infer<typeof authConfigSchema>;

/**
 * Registry configuration
 */
export type RegistryConfig = z.infer<typeof registryConfigSchema>;

/**
 * Complete Agentage configuration
 */
export type AgentageConfig = z.infer<typeof agentageConfigSchema>;

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
