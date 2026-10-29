import { type DiscoveredPlugin } from './discover.js';

export type StaticState = 'installed' | 'off' | 'blocked' | 'invalid' | 'missing';

export interface StaticResult {
  state: StaticState;
  error: string | null;
}

type ByPkg = Map<string, DiscoveredPlugin>;

const reaches = (from: string, target: string, byPkg: ByPkg, seen: Set<string>): boolean =>
  (byPkg.get(from)?.peers ?? []).some((peer) => {
    if (peer === target) return true;
    if (seen.has(peer)) return false;
    seen.add(peer);
    return reaches(peer, target, byPkg, seen);
  });

const inCycle = (p: DiscoveredPlugin, byPkg: ByPkg): boolean =>
  reaches(p.pkg, p.pkg, byPkg, new Set());

const missingReason = (p: DiscoveredPlugin): string =>
  p.source === 'dev' ? `no package.json at ${p.dir}` : 'not installed in the current tree';

const ownState = (p: DiscoveredPlugin, off: string[], byPkg: ByPkg): StaticResult => {
  if (p.problem) return { state: 'invalid', error: p.problem };
  if (p.missing) return { state: 'missing', error: missingReason(p) };
  if (inCycle(p, byPkg)) return { state: 'invalid', error: 'peer dependency cycle' };
  if (p.source === 'tree' && off.includes(p.pkg)) return { state: 'off', error: null };
  return { state: 'installed', error: null };
};

interface Walk {
  byPkg: ByPkg;
  own: Map<string, StaticResult>;
  done: Map<string, StaticResult>;
}

const peerBlock = (p: DiscoveredPlugin, walk: Walk): StaticResult | null => {
  for (const peer of p.peers.filter((name) => !p.optionalPeers.includes(name))) {
    const target = walk.byPkg.get(peer);
    if (!target) return { state: 'blocked', error: `peer ${peer} is not in the profile` };
    const { state } = resolveState(target, walk);
    if (state !== 'installed') return { state: 'blocked', error: `peer ${peer} is ${state}` };
  }
  return null;
};

// Cycles are already invalid, so the recursion through peers always terminates.
const resolveState = (p: DiscoveredPlugin, walk: Walk): StaticResult => {
  const cached = walk.done.get(p.pkg);
  if (cached) return cached;
  const own: StaticResult = walk.own.get(p.pkg) ?? { state: 'invalid', error: null };
  const result = own.state === 'installed' ? (peerBlock(p, walk) ?? own) : own;
  walk.done.set(p.pkg, result);
  return result;
};

// The states `status` can know without running plugin code; `ok` and `failed` need a load.
export const staticStates = (
  plugins: DiscoveredPlugin[],
  off: string[]
): Map<string, StaticResult> => {
  const byPkg: ByPkg = new Map(plugins.map((p) => [p.pkg, p]));
  const own = new Map(plugins.map((p) => [p.pkg, ownState(p, off, byPkg)]));
  const walk: Walk = { byPkg, own, done: new Map() };
  for (const p of plugins) resolveState(p, walk);
  return walk.done;
};
