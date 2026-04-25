import { isAbsolute, relative, resolve } from 'node:path';

export const safeJoin = (vaultPath: string, vaultRelPath: string): string => {
  if (isAbsolute(vaultRelPath)) {
    throw new Error('path must be vault-relative, not absolute');
  }
  const full = resolve(vaultPath, vaultRelPath);
  const rel = relative(vaultPath, full);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes the vault root');
  }
  return full;
};
