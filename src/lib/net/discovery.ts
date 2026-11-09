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

// An unserved document (404, unreachable, not JSON) keeps today's api origin; a served one without a platform fails.
export const discoverPlatform = async (fqdn: string, get: Get = cliFetch): Promise<Platform> => {
  const url = `${links(fqdn).site}/.well-known/agentage.json`;
  const doc: unknown = await get(url)
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined);
  if (doc === undefined) {
    const api = apiOrigin(fqdn);
    return { url: api, machines: `${api}/v1/machines` };
  }
  const platform = isRecord(doc) ? doc['platform'] : undefined;
  if (typeof platform !== 'string' || !URL.canParse(platform))
    throw new Error(`FAIL discovery: ${url} has no "platform"`);
  const base = platform.replace(/\/+$/, '');
  return { url: base, machines: `${base}/api/v1/machines` };
};
