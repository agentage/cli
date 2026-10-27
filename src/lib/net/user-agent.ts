import { VERSION } from '../../utils/version.js';

// Identify the caller and its version so the server can observe which CLI connects.
export const requestHeaders = (): Record<string, string> => ({
  'User-Agent': `agentage-cli/${VERSION}`,
  'X-Agentage-CLI-Version': VERSION,
});
