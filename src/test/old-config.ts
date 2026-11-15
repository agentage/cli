import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeKitExtension } from './kit-fixture.js';

const TREE = '9a3e5c0d1b7f2a64';
const name = (id: string) => `@agentage/extension-${id}`;

const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

// The tree 0.51.1 installed: alpha 1.0.0 and beta 2.0.0, extensions/current naming it.
const writeTree = (config: string): void => {
  const tree = join(config, 'extensions', 'trees', TREE);
  const deps = { [name('alpha')]: '1.0.0', [name('beta')]: '2.0.0' };
  for (const [id, version] of [
    ['alpha', '1.0.0'],
    ['beta', '2.0.0'],
  ] as const)
    writeKitExtension(join(tree, 'node_modules', name(id)), id, version);
  write(join(tree, 'package.json'), {
    name: 'agentage-extensions',
    private: true,
    dependencies: deps,
  });
  const lock = { lockfileVersion: 3, packages: { '': { dependencies: deps } } };
  for (const at of [
    join(tree, 'package-lock.json'),
    join(config, 'extensions', 'package-lock.json'),
  ])
    write(at, lock);
  write(join(tree, '.complete'), '');
  write(join(config, 'extensions', 'current'), `${TREE}\n`);
};

// Three dev folders: devon runs, devoff is off on this machine, unsafe is world-writable.
const devFolders = (): Record<string, string> => {
  const root = mkdtempSync(join(tmpdir(), 'agentage-dev-'));
  const dev: Record<string, string> = {};
  for (const id of ['devon', 'devoff', 'unsafe'])
    dev[name(id)] = writeKitExtension(join(root, id), id, '0.1.0');
  chmodSync(dev[name('unsafe')] ?? '', 0o777);
  return dev;
};

// A config folder exactly as cli 0.51.1 leaves it: profile.json, machine.json and the tree.
export const writeOldConfig = (config: string): void => {
  const extensions = { [name('alpha')]: '^1.0.0', [name('beta')]: '^2.0.0' };
  const configMap = { alpha: { 'echo.prefix': 'hey' }, beta: { 'echo.repeat': 2 } };
  const machines = { m_0000beef: { off: [name('devoff')] } };
  write(join(config, 'profile.json'), { version: 1, extensions, config: configMap, machines });
  const machine = { id: 'm_0000beef', name: 'box', dev: devFolders(), profileSource: 'default' };
  write(join(config, 'machine.json'), { ...machine, accountId: null, profileEtag: null });
  writeTree(config);
};
