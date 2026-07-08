import { VERSION } from '../../utils/version.js';

export type RequestComponent = 'cli' | 'daemon';

export interface RequestHeaderOptions {
  component: RequestComponent;
  // The local daemon's version from loopback /health; omitted or 'none' when stopped.
  daemonVersion?: string;
}

// Identify the caller + versions so the server can observe which CLI + daemon connect.
export const requestHeaders = (opts: RequestHeaderOptions): Record<string, string> => ({
  'User-Agent': `agentage-${opts.component}/${VERSION}`,
  'X-Agentage-CLI-Version': VERSION,
  'X-Agentage-Daemon-Version':
    opts.component === 'daemon' ? VERSION : (opts.daemonVersion ?? 'none'),
});
