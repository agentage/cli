/**
 * npm played against fixtures/ for the unit tests of the installer and `setup`: what a registry
 * serving the fixture extensions would install.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Npm, type NpmCommand } from '../core/installer/npm.js';
import { fixture } from './config-dir.js';

// What a registry would report for a fixture: its version, and an integrity from its bytes.
const lockEntry = (name: string) => {
  const manifest = readFileSync(join(fixture(name), 'package.json'));
  const version = (JSON.parse(manifest.toString()) as { version: string }).version;
  return { version, integrity: `sha512-${createHash('sha512').update(manifest).digest('base64')}` };
};

const lockFor = (dependencies: Record<string, string>): string => {
  const entries = Object.keys(dependencies).map((n) => [`node_modules/${n}`, lockEntry(n)]);
  return JSON.stringify({ packages: { '': { dependencies }, ...Object.fromEntries(entries) } });
};

interface Manifest {
  dependencies: Record<string, string>;
}

const dependenciesOf = (command: NpmCommand, tree: string): Record<string, string> => {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(tree, file), 'utf-8'));
  if (command === 'install') return (read('package.json') as Manifest).dependencies;
  return (read('package-lock.json') as { packages: { '': Manifest } }).packages[''].dependencies;
};

// Plays npm against fixtures/: `install` unpacks each dependency's fixture and writes a lock,
// `ci` unpacks what the lock names; a name with no fixture fails the way a registry 404 does.
export const npmFromFixtures = async (): Promise<Npm> => async (command, tree) => {
  const deps = dependenciesOf(command, tree);
  const absent = Object.keys(deps).find((name) => !existsSync(fixture(name)));
  if (absent)
    return { code: 1, stdout: '', stderr: `npm error code E404\nnpm error 404 ${absent}` };
  for (const name of Object.keys(deps))
    cpSync(fixture(name), join(tree, 'node_modules', name), { recursive: true });
  if (command === 'install') writeFileSync(join(tree, 'package-lock.json'), lockFor(deps));
  return { code: 0, stdout: `added ${Object.keys(deps).length} packages`, stderr: '' };
};
