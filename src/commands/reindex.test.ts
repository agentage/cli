import { describe, expect, it, vi } from 'vitest';
import { VaultsConfig } from '../lib/vaults.schema.js';
import { runReindex, type ReindexDeps } from './reindex.js';

const cfg = (names: string[]): VaultsConfig =>
  VaultsConfig.parse({
    version: 1,
    vaults: names.map((n) => ({ name: n, type: 'local', path: `~/vaults/${n}` })),
  });

const makeDeps = (config: VaultsConfig) => {
  const logs: string[] = [];
  const reindex = vi.fn(async () => ({ added: 1, modified: 0, removed: 0, unchanged: 2 }));
  const deps: ReindexDeps = {
    load: () => ({ config, source: null }),
    reindex,
    log: (m) => logs.push(m),
  };
  return { deps, logs, reindex };
};

describe('runReindex', () => {
  it('reindexes every vault when no name is given', async () => {
    const h = makeDeps(cfg(['a', 'b']));
    await runReindex(undefined, h.deps);
    expect(h.reindex).toHaveBeenCalledTimes(2);
    expect(h.logs.join()).toContain("Reindexed 'a'");
  });

  it('reindexes only the named vault, passing its path', async () => {
    const h = makeDeps(cfg(['a', 'b']));
    await runReindex('b', h.deps);
    expect(h.reindex).toHaveBeenCalledTimes(1);
    expect(h.reindex).toHaveBeenCalledWith('b', '~/vaults/b');
  });

  it('throws when the named vault is unknown', async () => {
    const h = makeDeps(cfg(['a']));
    await expect(runReindex('nope', h.deps)).rejects.toThrow(/not found/);
  });

  it('reports when there are no vaults', async () => {
    const h = makeDeps(cfg([]));
    await runReindex(undefined, h.deps);
    expect(h.logs.join()).toContain('No vaults');
    expect(h.reindex).not.toHaveBeenCalled();
  });
});
