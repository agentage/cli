/**
 * Hand-placed plugin trees for the core specs: fixture packages copied under
 * plugins/trees/x/node_modules with the .complete marker and the plugins/current pointer,
 * the layout the installer produces, without running npm.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(process.cwd(), 'fixtures');
export const MACHINE_ID = 'm_0000beef';
export const HELLO = '@agentage/fixture-hello';
export const WORLD = '@agentage/fixture-world';
export const OLD = '@agentage/fixture-old-engine';
export const DUP = '@agentage/fixture-dup-id';
export const MACHINE = { id: MACHINE_ID, name: 'e2e-box', dev: {}, profileSource: 'default' };
export const LAST_RUN = { at: '2026-10-29T10:00:00.000Z', pid: 4242, state: 'ok', error: null };

export const writeJson = (dir: string, rel: string, value: unknown): void => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), JSON.stringify(value, null, 2));
};

export const placeTree = (configDir: string, fixtures: string[]): void => {
  const tree = join(configDir, 'plugins', 'trees', 'x');
  for (const f of fixtures) {
    const target = join(tree, 'node_modules', '@agentage', `fixture-${f}`);
    cpSync(join(FIXTURES, `plugin-${f}`), target, { recursive: true });
  }
  writeFileSync(join(tree, '.complete'), '');
  writeFileSync(join(configDir, 'plugins', 'current'), 'x\n');
};

// Every fixture in the tree, a complete machine.json and one state file for hello.
export const seed = (
  configDir: string,
  plugins: Record<string, string>,
  off: string[] = []
): void => {
  placeTree(configDir, ['hello', 'world', 'old-engine', 'dup-id']);
  writeJson(configDir, 'machine.json', MACHINE);
  writeJson(configDir, 'profile.json', {
    version: 1,
    plugins,
    machines: { [MACHINE_ID]: { off } },
  });
  writeJson(configDir, 'state/hello.json', LAST_RUN);
};

// Path -> content hash for every file, without following links.
export const snapshot = (dir: string, prefix = ''): Record<string, string> =>
  Object.assign(
    {},
    ...readdirSync(dir, { withFileTypes: true }).map((e) => {
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) return { [rel]: 'dir', ...snapshot(join(dir, e.name), `${rel}/`) };
      return {
        [rel]: createHash('sha256')
          .update(readFileSync(join(dir, e.name)))
          .digest('hex'),
      };
    })
  );

export const fixtureVersion = (fixture: string): string => {
  const path = join(FIXTURES, `plugin-${fixture}`, 'package.json');
  return (JSON.parse(readFileSync(path, 'utf-8')) as { version: string }).version;
};
