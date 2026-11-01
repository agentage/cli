/**
 * Files on an e2e/core machine: its config dir as the kit reads and writes it, a hash of that
 * dir, and copies of fixtures/ outside it for `extension install <path>`.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// update-check.json is the CLI's own update throttle, which any command may refresh.
export const hashTree = (dir: string, prefix = ''): Record<string, string> =>
  Object.assign(
    {},
    ...readdirSync(dir, { withFileTypes: true }).map((e) => {
      if (e.name === 'update-check.json') return {};
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) return { [rel]: 'dir', ...hashTree(join(dir, e.name), `${rel}/`) };
      return {
        [rel]: createHash('sha256')
          .update(readFileSync(join(dir, e.name)))
          .digest('hex'),
      };
    })
  );

export const configFiles = (configDir: string) => {
  const at = (path: string): string => join(configDir, path);
  return {
    file: (path: string) => readFileSync(at(path), 'utf-8').trim(),
    json: (path: string) => JSON.parse(readFileSync(at(path), 'utf-8')) as Record<string, unknown>,
    write: (path: string, value: unknown): void => {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), JSON.stringify(value, null, 2));
    },
    remove: (path: string): void => rmSync(at(path), { recursive: true, force: true }),
    exists: (path: string) => existsSync(at(path)),
    list: (path: string) => (existsSync(at(path)) ? readdirSync(at(path)).sort() : []),
  };
};

export type ConfigFiles = ReturnType<typeof configFiles>;

// fixtures/extension-<name> copied into `scratch`; `edits` replaces text in its package.json.
export const fixtureCopy =
  (scratch: string) =>
  (name: string, edits: Record<string, string> = {}): string => {
    const dir = join(scratch, `extension-${name}`);
    cpSync(join(process.cwd(), 'fixtures', `extension-${name}`), dir, { recursive: true });
    const manifest = join(dir, 'package.json');
    const text = readFileSync(manifest, 'utf-8');
    writeFileSync(
      manifest,
      Object.entries(edits).reduce((out, [from, to]) => out.replace(from, to), text)
    );
    return dir;
  };
