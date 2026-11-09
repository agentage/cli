import { isRecord } from '../fs/json-file.js';
import { cliFetch } from './fetch.js';
import { links } from './origins.js';

type Get = (url: string) => Promise<Response>;

// The platform URL the site's discovery document names; any gap fails naming the document.
export const discoverPlatform = async (fqdn: string, get: Get = cliFetch): Promise<string> => {
  const url = `${links(fqdn).site}/.well-known/agentage.json`;
  const doc: unknown = await get(url)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const platform = isRecord(doc) ? doc['platform'] : undefined;
  if (typeof platform !== 'string' || !URL.canParse(platform))
    throw new Error(`FAIL discovery: ${url} has no "platform"`);
  return platform.replace(/\/+$/, '');
};
