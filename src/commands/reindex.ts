import { reindexNamedVault, type ReindexStats } from '../lib/vault-scan.js';
import { loadVaultsConfig, type LoadedVaults } from '../lib/vaults.js';

export interface ReindexDeps {
  load: () => LoadedVaults;
  reindex: (name: string, vaultPath: string) => Promise<ReindexStats>;
  log: (msg: string) => void;
}

const defaultDeps: ReindexDeps = {
  load: loadVaultsConfig,
  reindex: reindexNamedVault,
  log: (msg) => console.log(msg),
};

// Rebuild one vault's index (or every vault's when name is omitted) from its markdown.
export const runReindex = async (
  name: string | undefined,
  deps: ReindexDeps = defaultDeps
): Promise<void> => {
  const { vaults } = deps.load().config;
  const targets = name ? vaults.filter((v) => v.name === name) : vaults;
  if (name && targets.length === 0) throw new Error(`vault '${name}' not found`);
  if (targets.length === 0) {
    deps.log('No vaults to reindex.');
    return;
  }
  for (const v of targets) {
    const s = await deps.reindex(v.name, v.path);
    deps.log(`Reindexed '${v.name}': +${s.added} ~${s.modified} -${s.removed} (=${s.unchanged})`);
  }
};
