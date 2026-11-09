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

// Sign-in may also sit on a subdomain of the site's parent domain (next.agentage.io -> auth.agentage.io).
export const issuerAllowed = (issuer: string, site: string): boolean => {
  if (sameSite(issuer, site)) return true;
  if (!URL.canParse(issuer)) return false;
  const [i, s] = [new URL(issuer), new URL(site)];
  const parent = s.hostname.slice(s.hostname.indexOf('.') + 1);
  return i.protocol === s.protocol && parent.includes('.') && i.hostname.endsWith(`.${parent}`);
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

// An unserved document (404, 5xx, redirect, unreachable) keeps the api and auth origins; a served one without a platform fails.
export const discoverTarget = async (fqdn: string, get: Get = cliFetch): Promise<Target> => {
  const base = links(fqdn);
  const url = `${base.site}/.well-known/agentage.json`;
  const doc = await read(url, get);
  if (doc === undefined) {
    const api = apiOrigin(fqdn);
    return {
      links: base,
      platform: { url: api, machines: `${api}/v1/machines` },
      discovered: false,
    };
  }
  const platform = platformOf(doc, base.site, url);
  return { links: { ...base, auth: issuerOf(doc, base, url) }, platform, discovered: true };
};

export const discoverPlatform = async (fqdn: string, get: Get = cliFetch): Promise<Platform> =>
  (await discoverTarget(fqdn, get)).platform;
