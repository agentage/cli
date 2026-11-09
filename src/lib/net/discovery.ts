import { isRecord } from '../fs/json-file.js';
import { cliFetch } from './fetch.js';
import { apiOrigin, links } from './origins.js';

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

// An unserved document (404, 5xx, redirect, unreachable) keeps the api origin; a served one without a platform fails.
export const discoverPlatform = async (fqdn: string, get: Get = cliFetch): Promise<Platform> => {
  const site = links(fqdn).site;
  const url = `${site}/.well-known/agentage.json`;
  const doc = await read(url, get);
  if (doc === undefined) {
    const api = apiOrigin(fqdn);
    return { url: api, machines: `${api}/v1/machines` };
  }
  const platform = isRecord(doc) ? doc['platform'] : undefined;
  if (typeof platform !== 'string' || !sameSite(platform, site))
    throw new Error(`FAIL discovery: ${url} has no "platform"`);
  const origin = new URL(platform).origin;
  return { url: origin, machines: `${origin}/api/v1/machines` };
};
