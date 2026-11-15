import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The installed kit's folder, wherever npm put it (resolved, not a node_modules path).
const KIT = dirname(createRequire(import.meta.url).resolve('@agentage/extension/package.json'));

// A kit file no export names, for a test that holds a cli copy equal to it; a move fails loudly.
export const kitInternal = async <T>(file: string, copy: string): Promise<T> => {
  const path = join(KIT, file);
  if (!existsSync(path))
    throw new Error(`the kit has no ${file} now: compare ${copy} with the kit, then fix this path`);
  return (await import(pathToFileURL(path).href)) as T;
};
