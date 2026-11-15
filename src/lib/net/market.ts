import { isRecord } from '../fs/json-file.js';
import { CliError, messageOf } from '../json-output.js';
import { cliFetch } from './fetch.js';
import {
  answered,
  isTimeout,
  marketError,
  noDiscovery,
  noMarket,
  notTheDocument,
  unreached,
} from './market-error.js';
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
  // Why a call failed to reach a market (null while none did): the answers are not to be shown.
  down: () => CliError | null;
}

const TIMEOUT_MS = 5_000;

const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const timed: Get = (url) => cliFetch(url, {}, { timeoutMs: TIMEOUT_MS });

const fetched = (get: Get, url: string): Promise<Response> =>
  get(url).catch((err: unknown) => {
    throw unreached(url, err, TIMEOUT_MS);
  });

const bodyOf = (res: Response, url: string): Promise<unknown> =>
  res.json().catch((err: unknown) => {
    throw isTimeout(err) ? unreached(url, err, TIMEOUT_MS) : answered(url, res.status, 'no JSON');
  });

const json = async (get: Get, url: string): Promise<Record<string, unknown> | null> => {
  const res = await fetched(get, url);
  if (res.status === 404) return null;
  if (!res.ok) throw answered(url, res.status);
  const body = await bodyOf(res, url);
  return isRecord(body) ? body : null;
};

// Only the site's own 404 means it has none. A redirect or a page that is no JSON object (a
// network's sign-in page) is not the site's answer; another status is a failure.
const discovery = async (fqdn: string, get: Get): Promise<Record<string, unknown>> => {
  const url = `${links(fqdn).site}/.well-known/agentage.json`;
  const res = await fetched(get, url);
  if (res.status === 404) throw noDiscovery(fqdn, url, 'answered 404');
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? 'no Location';
    throw notTheDocument(url, `answered ${res.status} to ${to}`);
  }
  if (!res.ok) throw answered(url, res.status);
  const doc = await res.json().catch(() => null);
  if (!isRecord(doc)) throw notTheDocument(url, `answered ${res.status} with no JSON object`);
  return doc;
};

// The first market the site's discovery document names: https, or http when the site is local.
const marketUrl = async (fqdn: string, get: Get): Promise<string> => {
  const doc = await discovery(fqdn, get);
  const { site } = links(fqdn);
  const first = Array.isArray(doc['markets']) ? doc['markets'][0] : undefined;
  const url = typeof first === 'string' && URL.canParse(first) ? new URL(first) : null;
  const local = url?.protocol === 'http:' && site.startsWith('http:');
  if (!url || (url.protocol !== 'https:' && !local))
    throw noMarket(fqdn, `${site}/.well-known/agentage.json`);
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

// Never throws for a missing or silent market: it answers null and `down` keeps the first reason.
export const openMarket = (fqdn: string = siteFqdn(), get: Get = timed, known?: string): Market => {
  let base: Promise<string> | undefined = known === undefined ? undefined : Promise.resolve(known);
  let failure: CliError | null = null;
  const latest = async (id: string): Promise<Latest | null> => {
    let data: unknown;
    try {
      base ??= marketUrl(fqdn, get);
      const path = `/api/v1/extensions/${encodeURIComponent(id)}/latest`;
      data = (await json(get, `${await base}${path}`))?.['data'];
    } catch (err) {
      failure ??= err instanceof CliError ? err : marketError('market_failed', messageOf(err));
      return null;
    }
    return isRecord(data) ? accept(id, data) : null;
  };
  return { latest, down: () => failure };
};

export interface Offered {
  id: string;
  version: string;
}

const PAGE = 200;
// /latest calls in flight at once while listing.
const AT_ONCE = 8;

// A market that repeats its cursor would page for ever; past this the listing stops.
export const MAX_PAGES = 20;

// Every row of the market list, page after page while `meta.nextCursor` names one.
const pages = async (get: Get, url: string, cursor?: string, page = 1): Promise<unknown[]> => {
  if (page > MAX_PAGES)
    throw marketError(
      'market_failed',
      `the market list has more than ${MAX_PAGES} pages of ${PAGE}; stopped there`
    );
  const query = `?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const body = await json(get, `${url}${query}`);
  const data = Array.isArray(body?.['data']) ? body['data'] : [];
  const meta = body?.['meta'];
  const next = isRecord(meta) && typeof meta['nextCursor'] === 'string' ? meta['nextCursor'] : '';
  return next && data.length > 0 ? [...data, ...(await pages(get, url, next, page + 1))] : data;
};

export interface Skipped {
  id: string;
  reason: string;
}

export interface Listing {
  offered: Offered[];
  skipped: Skipped[];
}

// A row without an exact version (the market of today lists none) asks /latest for it.
const offered = async (row: unknown, market: Market): Promise<Offered | Skipped | null> => {
  if (!isRecord(row) || typeof row['id'] !== 'string') return null;
  const id = row['id'];
  if (typeof row['version'] === 'string' && EXACT.test(row['version']))
    return { id, version: row['version'] };
  try {
    const version = (await market.latest(id))?.version;
    const down = market.down();
    if (down) return { id, reason: down.message };
    return version ? { id, version } : { id, reason: 'the market has no version of it' };
  } catch (err) {
    return { id, reason: messageOf(err) };
  }
};

// `extension list --available`: each listed id with its newest version. Only a failed list call
// fails it; a row that cannot be read is skipped with its reason.
export const listMarket = async (fqdn: string = siteFqdn(), get: Get = timed): Promise<Listing> => {
  const base = await marketUrl(fqdn, get);
  const rows = await pages(get, `${base}/api/v1/extensions`);
  const found: (Offered | Skipped | null)[] = [];
  for (let i = 0; i < rows.length; i += AT_ONCE) {
    const batch = rows.slice(i, i + AT_ONCE);
    found.push(...(await Promise.all(batch.map((r) => offered(r, openMarket(fqdn, get, base))))));
  }
  const listing: Listing = { offered: [], skipped: [] };
  for (const row of found)
    if (row) 'version' in row ? listing.offered.push(row) : listing.skipped.push(row);
  return listing;
};
