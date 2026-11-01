export type Env = 'development' | 'production';

export interface Links {
  site: string;
  // Backend REST base on the dedicated `api.<fqdn>` host.
  api: string;
  auth: string;
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

// The account routes (/v1/...) sit at the root of the API origin; `links().api` is its /api family.
export const apiOrigin = (fqdn: string): string => {
  const stub = stubOrigin(fqdn);
  if (stub) return stub;
  return isLocal(fqdn) ? 'http://localhost:3001' : `https://api.${fqdn}`;
};

export const links = (fqdn: string): Links => {
  const stub = stubOrigin(fqdn);
  const api = `${apiOrigin(fqdn)}/api`;
  if (stub) return { site: stub, api, auth: stub };
  return isLocal(fqdn)
    ? { site: 'http://localhost:3000', api, auth: 'http://localhost:3010' }
    : { site: `https://${fqdn}`, api, auth: `https://auth.${fqdn}` };
};
