/**
 * The unit-test kit for src/core and src/commands/extension: `test` hands every test `dir`, a
 * brand-new config dir (AGENTAGE_CONFIG_DIR) that the real code reads and writes, removed
 * afterwards. Same words as the e2e kit: `write`, `file`, `json`, `profile`, `tree`; `extension`
 * writes a dev extension from source. `npm-fixtures.ts` plays npm against fixtures/.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import chalk from 'chalk';
import { test as base } from 'vitest';
import { extensionsDir } from '../core/paths.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const HAND_PLACED = 'hand-placed';
export const MACHINE_ID = 'm_0000beef';

// `hello` -> `@agentage/fixture-hello`; a scoped name stays as written.
export const pkg = (name: string): string =>
  name.startsWith('@') ? name : `@agentage/fixture-${name}`;

// The fixture folder behind a short or full name, e.g. a dev path or what npm would unpack.
export const fixture = (name: string): string =>
  join(FIXTURES, `extension-${pkg(name).replace('@agentage/fixture-', '')}`);

const expand = (map: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).map(([name, value]) => [pkg(name), value]));

export interface ProfileSpec {
  // Short fixture names (`hello` for `@agentage/fixture-hello`) or full package names.
  extensions?: Record<string, string>;
  off?: string[];
  [key: string]: unknown;
}

// Paths are relative to the config dir unless absolute.
const configFiles = (root: string) => {
  const at = (path: string): string => (isAbsolute(path) ? path : join(root, path));
  return {
    at,
    file: (path: string) => readFileSync(at(path), 'utf-8').trim(),
    json: (path: string) => JSON.parse(readFileSync(at(path), 'utf-8')) as Record<string, unknown>,
    // A string is written as is, anything else as JSON.
    write: (path: string, value: unknown): void => {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    },
    exists: (path: string) => existsSync(at(path)),
    list: (path: string) => (existsSync(at(path)) ? readdirSync(at(path)).sort() : []),
  };
};

type ConfigFiles = ReturnType<typeof configFiles>;

export interface ConfigDir extends ConfigFiles {
  machine: (dev?: Record<string, string>) => void;
  profile: (spec: ProfileSpec, path?: string) => string;
  // Fixtures in a complete tree extensions/current names, as npm leaves it for profile.json.
  tree: (...fixtures: string[]) => string;
  // A dev extension `@test/<id>` written from source, listed in machine.json; returns its name.
  extension: (id: string, source: string, manifest?: Record<string, unknown>) => string;
}

const writeMachine = (files: ConfigFiles, dev: Record<string, string> = {}): void =>
  files.write('machine.json', {
    id: MACHINE_ID,
    name: 'box',
    dev: expand(dev),
    profileSource: 'default',
  });

// This machine's entry turning `off` off; machine.json is written first when absent.
const offHere = (files: ConfigFiles, off: string[]) => {
  if (!files.exists('machine.json')) writeMachine(files);
  return { machines: { [String(files.json('machine.json')['id'])]: { off: off.map(pkg) } } };
};

const writeProfile = (files: ConfigFiles, spec: ProfileSpec, path: string): string => {
  const { extensions = {}, off, ...rest } = spec;
  const machines = off ? offHere(files, off) : {};
  files.write(path, { version: 1, ...rest, extensions: expand(extensions), ...machines });
  return files.at(path);
};

// The lock an install of profile.json leaves: its extensions as root dependencies.
const installedLock = (files: ConfigFiles) => {
  const profile = files.exists('profile.json') ? files.json('profile.json') : {};
  return { packages: { '': { dependencies: profile['extensions'] ?? {} } } };
};

const writeTree = (files: ConfigFiles, fixtures: string[]): string => {
  const dir = join(extensionsDir(), 'trees', HAND_PLACED);
  for (const name of fixtures)
    cpSync(fixture(name), join(dir, 'node_modules', pkg(name)), { recursive: true });
  files.write(join(dir, '.complete'), '');
  files.write(join(extensionsDir(), 'package-lock.json'), installedLock(files));
  files.write(join(extensionsDir(), 'current'), `${HAND_PLACED}\n`);
  return dir;
};

const writeExtension = (
  files: ConfigFiles,
  id: string,
  source: string,
  manifest: Record<string, unknown>
): string => {
  const name = `@test/${id}`;
  const agentage = { id, ...(manifest['agentage'] as object | undefined) };
  const base = { name, version: '1.0.0', type: 'module', main: 'index.js' };
  files.write(`dev/${id}/package.json`, { ...base, ...manifest, agentage });
  files.write(`dev/${id}/index.js`, source);
  const dev = files.exists('machine.json') ? files.json('machine.json')['dev'] : {};
  writeMachine(files, { ...(dev as Record<string, string>), [name]: files.at(`dev/${id}`) });
  return name;
};

const configDir = (root: string): ConfigDir => {
  const files = configFiles(root);
  return {
    ...files,
    machine: (dev) => writeMachine(files, dev),
    profile: (spec, path = 'profile.json') => writeProfile(files, spec, path),
    tree: (...fixtures) => writeTree(files, fixtures),
    extension: (id, source, manifest = {}) => writeExtension(files, id, source, manifest),
  };
};

export const test = base.extend<{ dir: ConfigDir }>({
  dir: [
    async ({}, use) => {
      const root = mkdtempSync(join(tmpdir(), 'agentage-unit-'));
      // Not created up front: the code under test makes it, as on a new machine.
      process.env['AGENTAGE_CONFIG_DIR'] = join(root, '.agentage');
      delete process.env['AGENTAGE_EXTENSIONS_DIR'];
      await use(configDir(join(root, '.agentage')));
      delete process.env['AGENTAGE_CONFIG_DIR'];
      delete process.env['AGENTAGE_EXTENSIONS_DIR'];
      rmSync(root, { recursive: true, force: true });
    },
    // Every test gets one, used or not: nothing it writes can reach another test.
    { auto: true },
  ],
});

export interface Output {
  stdout: string;
  stderr: string;
  lines: string[];
  // The message the command failed with, else null.
  error: string | null;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

// Colours stripped, as the e2e kit's `plain`.
export const plain = (text: string): string => text.replace(ANSI, '');

// Runs a command body and keeps what it printed, uncoloured, like the e2e kit's `run`.
export const output = async (fn: () => Promise<unknown>): Promise<Output> => {
  const out: string[] = [];
  const err: string[] = [];
  const saved = { log: console.log, error: console.error, level: chalk.level };
  console.log = (text: unknown) => void out.push(String(text));
  console.error = (text: unknown) => void err.push(String(text));
  chalk.level = 0;
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    error = (e as Error).message;
  } finally {
    Object.assign(console, { log: saved.log, error: saved.error });
    chalk.level = saved.level;
  }
  const stdout = out.join('\n');
  return { stdout, stderr: err.join('\n'), lines: stdout === '' ? [] : stdout.split('\n'), error };
};
