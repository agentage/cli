import { CliError } from '../json-output.js';

// One code per way a site's market can fail; the installer sends the same codes in upper case.
export type MarketCode =
  'no_discovery' | 'no_market' | 'market_unreachable' | 'market_failed' | 'market_timeout';

const CHOOSE = 'choose another site with AGENTAGE_SITE_FQDN=<site>';

export const marketError = (code: MarketCode, text: string): CliError => new CliError(code, text);

// 0.51: a site with no market resolves an id on npm. An unreachable or failing market stays an error.
export const noSiteMarket = (err: CliError | null): boolean =>
  err?.code === 'no_discovery' || err?.code === 'no_market';

export const fromNpmLine = (fqdn: string, what: string): string =>
  `${fqdn} has no extension market; ${what} from npm, as cli 0.51 did`;

// After a market lookup found no entry for id: why npm resolves it, or null when it does not
// (a market that is down stays an error). A market that answers without the id says so too.
export const npmFallbackLine = (
  fqdn: string,
  id: string,
  what: string,
  down: CliError | null
): string | null => {
  if (noSiteMarket(down)) return fromNpmLine(fqdn, what);
  return down
    ? null
    : `the market of ${fqdn} has no ${id}; ${what} from npm as @agentage/extension-${id}`;
};

export const noDiscovery = (fqdn: string, url: string, why: string): CliError =>
  marketError('no_discovery', `${fqdn} has no extension market: ${url} ${why}; ${CHOOSE}`);

export const noMarket = (fqdn: string, url: string): CliError =>
  marketError('no_market', `${fqdn} has no extension market: ${url} names none; ${CHOOSE}`);

// An answer, but not the discovery document: the network, not the site, may be the cause.
export const notTheDocument = (url: string, why: string): CliError =>
  marketError('market_unreachable', `${url} ${why}: not the discovery document; check the network`);

const isTimeout = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

// A fetch that threw: no answer in time, or no connection (the cause names why).
export const unreached = (url: string, err: unknown, timeoutMs: number): CliError => {
  if (isTimeout(err))
    return marketError('market_timeout', `${url} did not answer in ${timeoutMs / 1000} s`);
  const cause = (err as { cause?: { message?: string } }).cause?.message;
  return marketError(
    'market_unreachable',
    `cannot reach ${url}: ${cause ?? (err as Error).message}`
  );
};

export const answered = (url: string, status: number, why = ''): CliError =>
  marketError('market_failed', `${url} answered ${status}${why && `, ${why}`}`);
