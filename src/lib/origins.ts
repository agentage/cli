export type Env = 'development' | 'production';

export interface Links {
  site: string;
  // Backend REST base. Dedicated `api.<fqdn>` host (the apex `<fqdn>/api` was
  // retired in the 2026-06-17 subdomain cutover); mirrors @agentage/shared links().
  api: string;
  auth: string;
  mcp: string;
}

const DEFAULT_FQDN = 'agentage.io';

export const normalizeFqdn = (raw?: string): string => {
  const value = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return value || DEFAULT_FQDN;
};

export const siteFqdn = (): string => normalizeFqdn(process.env['AGENTAGE_SITE_FQDN']);

const isLocal = (fqdn: string): boolean =>
  fqdn === 'localhost' || fqdn.startsWith('localhost:') || fqdn.startsWith('127.0.0.1');

export const environment = (fqdn: string): Env =>
  isLocal(fqdn) || fqdn.startsWith('dev.') ? 'development' : 'production';

export const links = (fqdn: string): Links =>
  isLocal(fqdn)
    ? {
        site: 'http://localhost:3000',
        api: 'http://localhost:3001/api',
        auth: 'http://localhost:3010',
        mcp: 'http://localhost:3003/mcp',
      }
    : {
        site: `https://${fqdn}`,
        api: `https://api.${fqdn}/api`,
        auth: `https://auth.${fqdn}`,
        mcp: `https://memory.${fqdn}/mcp`,
      };
