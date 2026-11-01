import { type DiscoveredExtension } from './discover.js';

// Peers first, from `roots` through `all`; cycles are invalid already, `seen` ends the walk anyway.
export const loadOrder = (
  roots: DiscoveredExtension[],
  all: DiscoveredExtension[] = roots
): DiscoveredExtension[] => {
  const byPkg = new Map(all.map((ext) => [ext.pkg, ext]));
  const seen = new Set<string>();
  const ordered: DiscoveredExtension[] = [];
  const visit = (ext: DiscoveredExtension): void => {
    if (seen.has(ext.pkg)) return;
    seen.add(ext.pkg);
    for (const peer of [...ext.peers, ...ext.optionalPeers]) {
      const found = byPkg.get(peer);
      if (found) visit(found);
    }
    ordered.push(ext);
  };
  roots.forEach(visit);
  return ordered;
};
