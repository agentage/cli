import { isAccountVault, type VaultsConfig } from '@agentage/memory-core';

// Map one memory-verb wire payload to the account vault + vault-relative POSIX path it mutated, or
// null when the target is not an account vault (git/local mutations never touch the couch channel).
export const resolveMutationTarget = (
  config: VaultsConfig,
  body: unknown
): { vault: string; path: string } | null => {
  const p = (body ?? {}) as { ref?: unknown; opts?: { vault?: unknown } };
  const ref = typeof p.ref === 'string' ? p.ref : '';
  if (!ref) return null;
  let vault: string | undefined;
  let path: string;
  if (ref.startsWith('@')) {
    const m = ref.match(/^@([^/]+)\/(.+)$/);
    if (!m) return null; // a bare '@vault' is not a file mutation
    vault = m[1];
    path = m[2] as string;
  } else {
    vault = (typeof p.opts?.vault === 'string' ? p.opts.vault : undefined) ?? config.default;
    if (!vault) {
      const names = Object.keys(config.vaults ?? {});
      if (names.length === 1) vault = names[0];
    }
    path = ref;
  }
  if (!vault) return null;
  const entry = config.vaults?.[vault];
  if (!entry || !isAccountVault(entry)) return null;
  return { vault, path: path.replace(/^\.?\//, '') };
};
