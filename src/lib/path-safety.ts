import { isAbsolute, relative, resolve } from 'node:path';

// Resolve a vault-relative path to an absolute path, refusing anything that escapes the
// vault root (absolute inputs, `..` traversal). Ported from the v0.24 module.
export const safeJoin = (vaultPath: string, vaultRelPath: string): string => {
  if (isAbsolute(vaultRelPath)) throw new Error('path must be vault-relative, not absolute');
  const full = resolve(vaultPath, vaultRelPath);
  const rel = relative(vaultPath, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path escapes the vault root');
  return full;
};
