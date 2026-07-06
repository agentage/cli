export type Env = 'development' | 'production';

export interface Links {
  site: string;
  // Backend REST base. Dedicated `api.<fqdn>` host (the apex `<fqdn>/api` was
  // retired in the 2026-06-17 subdomain cutover); mirrors @agentage/shared links().
  api: string;
  auth: string;
  mcp: string;
  // Sync bootstrap host for GET /.well-known/agentage-sync (git + couch endpoints).
  sync: string;
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

// A loopback-IP-with-port fqdn (`127.0.0.1:<port>`) collapses every service onto that one
// origin, path-prefixed - the single-server stub convention the hermetic e2e drives. The bare
// `localhost` / `localhost:<port>` dev fqdns keep the multi-port dev mapping below untouched.
const stubOrigin = (fqdn: string): string | null => {
  const m = fqdn.match(/^127\.0\.0\.1:(\d+)$/);
  return m ? `http://127.0.0.1:${m[1]}` : null;
};

export const environment = (fqdn: string): Env =>
  isLocal(fqdn) || fqdn.startsWith('dev.') ? 'development' : 'production';

export const links = (fqdn: string): Links => {
  const stub = stubOrigin(fqdn);
  if (stub) return { site: stub, api: `${stub}/api`, auth: stub, mcp: `${stub}/mcp`, sync: stub };
  return isLocal(fqdn)
    ? {
        site: 'http://localhost:3000',
        api: 'http://localhost:3001/api',
        auth: 'http://localhost:3010',
        mcp: 'http://localhost:3003/mcp',
        sync: 'http://localhost:3011',
      }
    : {
        site: `https://${fqdn}`,
        api: `https://api.${fqdn}/api`,
        auth: `https://auth.${fqdn}`,
        mcp: `https://memory.${fqdn}/mcp`,
        sync: `https://sync.${fqdn}`,
      };
};
