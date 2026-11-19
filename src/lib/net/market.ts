import type { CoreClient, CoreReason, Fetch, Listing } from '@agentage/extension/core';
import { isRecord } from '../fs/json-file.js';
import { CliError } from '../json-output.js';
import { cliFetch, headedFetch } from './fetch.js';
import {
  answered,
  marketError,
  noDiscovery,
  noMarket,
  notTheDocument,
  unreached,
} from './market-error.js';
import { links, siteFqdn } from './origins.js';

export type { Listing, Offered, Skipped } from '@agentage/extension/core';

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

// The market list, or why it is empty: a silent market never fails a list.
export interface MarketListing extends Listing {
  down: CliError | null;
}

export interface MarketDeps {
  // The discovery read of the site.
  get: Get;
  // The core client's fetch: it keeps the client's signal.
  fetch: Fetch;
  // One bound for each market call, all its requests together.
  timeoutMs: number;
}

const DISCOVERY_TIMEOUT_MS = 5_000;
// An install or a list in a terminal: the client's 2 s default suits a page, not npm work.
const MARKET_TIMEOUT_MS = 10_000;

const timed: Get = (url) => cliFetch(url, {}, { timeoutMs: DISCOVERY_TIMEOUT_MS });

const DEFAULTS: MarketDeps = { get: timed, fetch: headedFetch, timeoutMs: MARKET_TIMEOUT_MS };

const fetched = (get: Get, url: string): Promise<Response> =>
  get(url).catch((err: unknown) => {
    throw unreached(url, err, DISCOVERY_TIMEOUT_MS);
  });

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

// The client calls url() on each call: one discovery read for each client.
const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
};

const CODES = { unreachable: 'market_unreachable', timeout: 'market_timeout' } as const;

const textOf = (down: CoreReason): string =>
  down.detail.startsWith(down.message) ? down.detail : `${down.message}: ${down.detail}`;

// The client's reason as the cli's error; a discovery error (no_discovery, no_market) stays itself.
export const marketDownError = (down: CoreReason): CliError => {
  if (down.cause instanceof CliError) return down.cause;
  const code = down.code === 'unreachable' || down.code === 'timeout' ? CODES[down.code] : null;
  return marketError(code ?? 'market_failed', textOf(down));
};

// Loaded on the first market call: a cold start never loads the kit's logs client.
const clientOf = async (fqdn: string, deps: MarketDeps): Promise<CoreClient> => {
  const { coreUrlOf, createCoreClient } = await import('@agentage/extension/core');
  // The core address of the env wins; else the market the site's discovery names.
  const url = coreUrlOf(process.env) ?? once(() => marketUrl(fqdn, deps.get));
  return createCoreClient({ url, timeoutMs: deps.timeoutMs, fetch: deps.fetch });
};

// Never throws for a missing or silent market: null, and `down` keeps the first reason. A
// refused answer (not an exact version of that id) throws: it is never installed.
export const openMarket = (fqdn: string = siteFqdn(), deps: Partial<MarketDeps> = {}): Market => {
  const client = once(() => clientOf(fqdn, { ...DEFAULTS, ...deps }));
  let failure: CliError | null = null;
  const latest = async (id: string): Promise<Latest | null> => {
    const { data, down } = await (await client()).market.latest(id);
    if (down?.code === 'refused') throw marketError('market_failed', textOf(down));
    if (down) failure ??= marketDownError(down);
    return data && { version: data.version, package: data.package };
  };
  return { latest, down: () => failure };
};

// `extension list --available`: each listed id with its newest version, or why there is none.
export const listMarket = async (
  fqdn: string = siteFqdn(),
  deps: Partial<MarketDeps> = {}
): Promise<MarketListing> => {
  const { data, down } = await (await clientOf(fqdn, { ...DEFAULTS, ...deps })).market.list();
  return { ...data, down: down && marketDownError(down) };
};
