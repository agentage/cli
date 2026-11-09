import { isRecord } from '../fs/json-file.js';
import { cliFetch } from './fetch.js';
import { apiOrigin, links, type Links } from './origins.js';

type Get = (url: string) => Promise<Response>;

export interface Platform {
  // Where registration is reported.
  url: string;
  // The machines routes' base.
  machines: string;
}

const debug = (text: string): void => {
  if (process.env['AGENTAGE_DEBUG'] === '1') console.error(`discovery: ${text}`);
};

// The bearer must not leave the site: same scheme, and the site's host or a subdomain of it.
const sameSite = (platform: string, site: string): boolean => {
  if (!URL.canParse(platform)) return false;
  const [p, s] = [new URL(platform), new URL(site)];
  return (
    p.protocol === s.protocol &&
    (p.hostname === s.hostname || p.hostname.endsWith(`.${s.hostname}`))
  );
};

const isIp = (host: string): boolean => /^[\d.]+$/.test(host) || host.startsWith('[');

// The parent rule needs a 3+ label site, so a 2-label parent is never a public suffix like co.uk.
const underParent = (host: string, site: string): boolean => {
  const labels = site.split('.');
  if (isIp(site) || labels.length < 3) return false;
  return host.endsWith(`.${labels.slice(1).join('.')}`);
};

// The issuer: the site, a subdomain of it, or (3+ label site) of its parent; no userinfo, no other port.
export const issuerAllowed = (issuer: string, site: string): boolean => {
  if (!URL.canParse(issuer)) return false;
  const [i, s] = [new URL(issuer), new URL(site)];
  if (i.username || i.password || i.port !== s.port) return false;
  return (
    sameSite(issuer, site) || (i.protocol === s.protocol && underParent(i.hostname, s.hostname))
  );
};

export interface Target {
  // `auth` is the issuer the discovery document names, else `auth.<fqdn>`.
  links: Links;
  platform: Platform;
  discovered: boolean;
}

const read = async (url: string, get: Get): Promise<unknown> => {
  try {
    const res = await get(url);
    if (res.ok) return await res.json();
    if (res.status !== 404) debug(`${url} answered ${res.status}, using the api origin`);
  } catch (err) {
    debug(`${url} failed (${(err as Error).message}), using the api origin`);
  }
  return undefined;
};

const platformOf = (doc: unknown, site: string, url: string): Platform => {
  const platform = isRecord(doc) ? doc['platform'] : undefined;
  if (typeof platform !== 'string' || !sameSite(platform, site))
    throw new Error(`FAIL discovery: ${url} has no "platform"`);
  const origin = new URL(platform).origin;
  return { url: origin, machines: `${origin}/api/v1/machines` };
};

const issuerOf = (doc: unknown, base: Links, url: string): string => {
  const issuer = isRecord(doc) ? doc['issuer'] : undefined;
  if (issuer === undefined) return base.auth;
  if (typeof issuer !== 'string' || !issuerAllowed(issuer, base.site))
    throw new Error(`FAIL discovery: ${url} names an issuer outside the site`);
  return new URL(issuer).origin;
};

// The origins derived from the fqdn alone, as before discovery.
export const derivedTarget = (fqdn: string): Target => {
  const api = apiOrigin(fqdn);
  const platform = { url: api, machines: `${api}/v1/machines` };
  return { links: links(fqdn), platform, discovered: false };
};

const fetchTarget = async (fqdn: string, get: Get): Promise<Target> => {
  const base = links(fqdn);
  const url = `${base.site}/.well-known/agentage.json`;
  const doc = await read(url, get);
  if (doc === undefined) return derivedTarget(fqdn);
  const platform = platformOf(doc, base.site, url);
  return { links: { ...base, auth: issuerOf(doc, base, url) }, platform, discovered: true };
};

const once = new Map<string, Promise<Target>>();

// Fetched once per run; an unserved document (404, 5xx, unreachable) keeps the derived origins,
// a served one without a valid platform or issuer fails closed.
export const discoverTarget = (fqdn: string, get: Get = cliFetch): Promise<Target> => {
  if (get !== cliFetch) return fetchTarget(fqdn, get);
  const found = once.get(fqdn) ?? fetchTarget(fqdn, get);
  once.set(fqdn, found);
  return found;
};
