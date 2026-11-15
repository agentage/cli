import { prunePackages } from '../../core/installer/package-dir.js';
import { versionsInUse } from '../../core/loader/installed.js';
import { type HostRow } from '../../lib/daemon/host-client.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { type Market, type Offered } from '../../lib/net/market.js';
import { type LifecycleDeps } from './lifecycle.js';

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
  available: () => Promise<Offered[]>;
  market: () => Market;
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

const available = async (deps: ListDeps): Promise<Offered[]> => {
  const offered = await deps.available().catch((err: unknown) => {
    throw new CliError('market_unavailable', `the market did not answer: ${messageOf(err)}`);
  });
  const lines = table([['ID', 'VERSION'], ...offered.map((o) => [o.id, o.version])]);
  for (const line of offered.length > 0 ? lines : ['the market lists nothing']) console.log(line);
  return offered;
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

const movesOf = async (rows: HostRow[], market: Market): Promise<Move[]> => {
  const moves: Move[] = [];
  for (const row of rows) {
    const to = (await market.latest(row.id))?.version;
    if (to && to !== row.version) moves.push({ id: row.id, from: row.version, to });
  }
  if (market.down()) throw new CliError('market_unavailable', 'the market did not answer');
  return moves;
};

const marketRows = async (opts: ExtensionUpdateOptions, rows: HostRow[]): Promise<HostRow[]> => {
  const chosen = rows.filter((r) => r.source === 'market' && (!opts.id || r.id === opts.id));
  if (opts.id && chosen.length === 0)
    throw new CliError('not_installed', `${opts.id} is not installed from the market`);
  return chosen;
};

// The market's newest version for each extension it installed (or one); --check changes nothing.
export const runUpdate = async (opts: ExtensionUpdateOptions, deps: ListDeps) => {
  const host = await deps.host();
  const moves = await movesOf(await marketRows(opts, await host.list()), deps.market());
  for (const { id, from, to } of moves) {
    // The daemon answers once the old child is stopped: its folder can go.
    if (!opts.check)
      await host.change(id, { version: to }).then(() => prunePackages(id, versionsInUse(id)));
    console.log(`${id} ${from} to ${to}${opts.check ? ' (available)' : ''}`);
  }
  if (moves.length === 0) console.log('every extension is at its newest version');
  return moves.map((move) => ({ ...move, updated: !opts.check }));
};
