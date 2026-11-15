import { type HostRow } from '../../lib/daemon/host-client.js';
import { CliError, messageOf, WithMeta } from '../../lib/json-output.js';
import { type Listing, type Market } from '../../lib/net/market.js';
import { fromNpmLine, noSiteMarket, npmFallbackLine } from '../../lib/net/market-error.js';
import { siteFqdn } from '../../lib/net/origins.js';
import { pruneUnused, type LifecycleDeps } from './lifecycle.js';

export interface ListOptions {
  available?: boolean;
  json?: boolean;
}

export interface ExtensionUpdateOptions {
  id?: string;
  check?: boolean;
  json?: boolean;
}

export interface ListDeps extends LifecycleDeps {
  available: () => Promise<Listing>;
  market: () => Market;
  // A site with no market: the newest version on npm, by the 0.51 names.
  npmNewest: (id: string) => Promise<string>;
}

// The daemon's rows as they are; a folder entry says `folder` and keeps its path.
const shown = (row: HostRow): HostRow =>
  row.source === 'market' ? row : { ...row, source: 'folder', path: row.source };

export const table = (rows: string[][]): string[] => {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length))) ?? [];
  return rows.map((r) =>
    r
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  );
};

const printRows = (rows: HostRow[]): void => {
  const cells = rows.map((r) => [r.id, r.version, r.source, r.state, r.error ?? '']);
  const lines = table([['ID', 'VERSION', 'SOURCE', 'STATE', ''], ...cells]);
  for (const line of rows.length > 0 ? lines : ['no extensions']) console.log(line);
};

// A row the market cannot answer for is left out and named on stderr; the others are listed.
const available = async (deps: ListDeps): Promise<WithMeta> => {
  const { offered, skipped } = await deps.available();
  const lines = table([['ID', 'VERSION'], ...offered.map((o) => [o.id, o.version])]);
  for (const line of offered.length > 0 ? lines : ['the market lists nothing']) console.log(line);
  if (skipped.length > 0)
    console.error(`skipped ${skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}`);
  return new WithMeta(offered, { skipped });
};

export const runList = async (opts: ListOptions, deps: ListDeps) => {
  if (opts.available) return available(deps);
  const rows = (await (await deps.host()).list()).map(shown);
  printRows(rows);
  return rows;
};

interface Move {
  id: string;
  from: string;
  to: string;
}

// The market's newest; a market without the id names it on stderr, then npm decides.
const newestOf = async (id: string, market: Market, deps: ListDeps): Promise<string | null> => {
  const to = (await market.latest(id))?.version;
  const down = market.down();
  if (to || (down && !noSiteMarket(down))) return to ?? null;
  if (!down) console.error(npmFallbackLine(siteFqdn(), id, `${id} resolves`, null));
  return deps.npmNewest(id);
};

// An id npm cannot resolve is named and skipped: the other ids still update.
const movesOf = async (rows: HostRow[], deps: ListDeps) => {
  const market = deps.market();
  const moves: Move[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    const to = await newestOf(row.id, market, deps).catch((err: unknown) => {
      failed.push(`${row.id}: ${messageOf(err)}`);
      return null;
    });
    if (to && to !== row.version) moves.push({ id: row.id, from: row.version, to });
  }
  const down = market.down();
  if (down && !noSiteMarket(down)) throw down;
  if (down && rows.length > 0) console.error(fromNpmLine(siteFqdn(), 'newest versions'));
  return { moves, failed };
};

const marketRows = async (opts: ExtensionUpdateOptions, rows: HostRow[]): Promise<HostRow[]> => {
  const chosen = rows.filter((r) => r.source === 'market' && (!opts.id || r.id === opts.id));
  if (opts.id && chosen.length === 0)
    throw new CliError('not_installed', `${opts.id} is not installed from the market`);
  return chosen;
};

// The market's newest version for each extension it installed (or one); --check changes nothing.
// Ids with no newest version fail the run at the end (exit 1), after the others updated.
export const runUpdate = async (opts: ExtensionUpdateOptions, deps: ListDeps) => {
  const host = await deps.host();
  const { moves, failed } = await movesOf(await marketRows(opts, await host.list()), deps);
  for (const { id, from, to } of moves) {
    if (!opts.check) await host.change(id, { version: to }).then(() => pruneUnused(id));
    console.log(`${id} ${from} to ${to}${opts.check ? ' (available)' : ''}`);
  }
  if (moves.length === 0 && failed.length === 0)
    console.log('every extension is at its newest version');
  if (failed.length > 0)
    throw new CliError('extension_failed', `no newest version found:\n  ${failed.join('\n  ')}`);
  return moves.map((move) => ({ ...move, updated: !opts.check }));
};
