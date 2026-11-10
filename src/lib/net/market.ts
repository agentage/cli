import { isRecord } from '../fs/json-file.js';
import { cliFetch } from './fetch.js';
import { links, siteFqdn } from './origins.js';

type Get = (url: string) => Promise<Response>;

export interface Latest {
  version: string;
  // null for a private entry: it has no npm package to install.
  package: string | null;
}

// `latest` is null for an id the market does not know, or when no market answers.
export interface Market {
  latest: (id: string) => Promise<Latest | null>;
  // True once a call failed to reach a market: the answers are not to be shown.
  down: () => boolean;
}

const TIMEOUT_MS = 5_000;
const UNAVAILABLE = 'market unavailable, versions not checked';

const timed: Get = (url) => cliFetch(url, {}, { timeoutMs: TIMEOUT_MS });

const json = async (get: Get, url: string): Promise<Record<string, unknown> | null> => {
  const res = await get(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body: unknown = await res.json();
  return isRecord(body) ? body : null;
};

// The first market the site's discovery document names; never an address of ours.
const marketUrl = async (fqdn: string, get: Get): Promise<string> => {
  const doc = await json(get, `${links(fqdn).site}/.well-known/agentage.json`);
  const first = Array.isArray(doc?.['markets']) ? doc['markets'][0] : undefined;
  if (typeof first !== 'string' || !URL.canParse(first)) throw new Error('no market');
  return new URL(first).origin;
};

// Never throws: a missing or silent market prints one line on stderr and answers null.
export const openMarket = (fqdn: string = siteFqdn(), get: Get = timed): Market => {
  let base: Promise<string> | undefined;
  let told = false;
  const latest = async (id: string): Promise<Latest | null> => {
    try {
      base ??= marketUrl(fqdn, get);
      const doc = await json(
        get,
        `${await base}/api/v1/extensions/${encodeURIComponent(id)}/latest`
      );
      const data = doc?.['data'];
      if (!isRecord(data) || typeof data['version'] !== 'string') return null;
      const pkg = data['package'];
      return { version: data['version'], package: typeof pkg === 'string' ? pkg : null };
    } catch {
      if (!told) console.error(UNAVAILABLE);
      told = true;
      return null;
    }
  };
  return { latest, down: () => told };
};
