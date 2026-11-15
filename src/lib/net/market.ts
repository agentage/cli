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

const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const timed: Get = (url) => cliFetch(url, {}, { timeoutMs: TIMEOUT_MS });

const json = async (get: Get, url: string): Promise<Record<string, unknown> | null> => {
  const res = await get(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body: unknown = await res.json();
  return isRecord(body) ? body : null;
};

// The first market the site's discovery document names: https, or http when the site is local.
const marketUrl = async (fqdn: string, get: Get): Promise<string> => {
  const { site } = links(fqdn);
  const doc = await json(get, `${site}/.well-known/agentage.json`);
  const first = Array.isArray(doc?.['markets']) ? doc['markets'][0] : undefined;
  const url = new URL(String(first));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && site.startsWith('http:')))
    throw new Error('no market');
  return url.origin;
};

// An answer is trusted only when it names this id's own package and one exact version.
const accept = (id: string, { version, package: pkg }: Record<string, unknown>): Latest => {
  const refuse = (why: string) => new Error(`market answer refused for ${id}: ${why}`);
  if (typeof version !== 'string' || !EXACT.test(version))
    throw refuse(`version ${JSON.stringify(version)} is not an exact version`);
  if (pkg !== null && pkg !== `@agentage/extension-${id}` && pkg !== `agentage-extension-${id}`)
    throw refuse(`package ${JSON.stringify(pkg)} is not an extension of that id`);
  return { version, package: pkg };
};

// Never throws: a missing or silent market prints one line on stderr and answers null.
export const openMarket = (fqdn: string = siteFqdn(), get: Get = timed): Market => {
  let base: Promise<string> | undefined;
  let told = false;
  const latest = async (id: string): Promise<Latest | null> => {
    let data: unknown;
    try {
      base ??= marketUrl(fqdn, get);
      const path = `/api/v1/extensions/${encodeURIComponent(id)}/latest`;
      data = (await json(get, `${await base}${path}`))?.['data'];
    } catch {
      if (!told) console.error(UNAVAILABLE);
      told = true;
      return null;
    }
    return isRecord(data) ? accept(id, data) : null;
  };
  return { latest, down: () => told };
};

export interface Offered {
  id: string;
  version: string;
}

const PAGE = 200;

// Every row of the market list, page after page while `meta.nextCursor` names one.
const pages = async (get: Get, url: string, cursor?: string): Promise<unknown[]> => {
  const query = `?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const body = await json(get, `${url}${query}`);
  const data = Array.isArray(body?.['data']) ? body['data'] : [];
  const meta = body?.['meta'];
  const next = isRecord(meta) && typeof meta['nextCursor'] === 'string' ? meta['nextCursor'] : '';
  return next && data.length > 0 ? [...data, ...(await pages(get, url, next))] : data;
};

// A row without an exact version (the market of today lists none) asks /latest for it.
const offered = async (row: unknown, market: Market): Promise<Offered | null> => {
  if (!isRecord(row) || typeof row['id'] !== 'string') return null;
  const listed = typeof row['version'] === 'string' && EXACT.test(row['version']);
  const version = listed ? String(row['version']) : (await market.latest(row['id']))?.version;
  return version ? { id: row['id'], version } : null;
};

// `extension list --available`: each listed id with its newest version; throws when no market answers.
export const listMarket = async (fqdn: string = siteFqdn(), get: Get = timed) => {
  const base = await marketUrl(fqdn, get);
  const rows = await pages(get, `${base}/api/v1/extensions`);
  const market = openMarket(fqdn, get);
  const found = await Promise.all(rows.map((row) => offered(row, market)));
  return found.filter((row): row is Offered => row !== null);
};
