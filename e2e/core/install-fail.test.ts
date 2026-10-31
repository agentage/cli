/**
 * @offline - a failed npm run: plugins/current keeps naming the last good tree, the staged
 * tree is removed, npm's last lines reach stderr and setup exits 1; the next good run
 * installs into a fresh tree and the rows follow.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, plain, type CliMachine } from '../helpers.js';
import { startStubSite, type StubSite } from '../stub/auth-server.js';
import {
  currentTree,
  installMachine,
  pluginsPath,
  profileFile,
  startFixtureRegistry,
  trees,
  type FixtureRegistry,
} from './install-harness.js';

const TWO = profileFile('two.json');
const MISSING = profileFile('missing.json');

let stub: StubSite;
let registry: FixtureRegistry;

const withMachine = async (fn: (machine: CliMachine) => Promise<void>): Promise<void> => {
  const machine = installMachine(stub, registry);
  try {
    await fn(machine);
  } finally {
    machine.cleanup();
  }
};

const npmLines = (stderr: string): string[] =>
  stderr
    .slice(stderr.indexOf('plugins/current is unchanged'))
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '' && !line.startsWith('update available'));

test.beforeAll(async () => {
  assertCliBuilt();
  stub = await startStubSite();
  registry = await startFixtureRegistry();
});

test.afterAll(async () => {
  await registry.close();
  await stub.close();
});

test.describe('installer failure @p0 @offline', () => {
  test('npm failure keeps the current tree, removes the staged one, exits 1 (T10)', () =>
    withMachine(async (machine) => {
      expect((await machine.exec(['setup', '--profile', TWO])).code).toBe(0);
      const good = currentTree(machine);
      const result = await machine.exec(['setup', '--profile', MISSING]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('npm install failed');
      const lines = npmLines(result.stderr);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(20);
      expect(lines.join('\n')).toContain('E404');
      expect(currentTree(machine)).toBe(good);
      expect(trees(machine)).toEqual([good]);
      expect(plain(result.stdout)).toMatch(/missing\s+@agentage\/fixture-missing/);
    }));

  test('the next good run installs into a fresh tree and refreshes the rows (T26)', () =>
    withMachine(async (machine) => {
      const failed = await machine.exec(['setup', '--profile', MISSING]);
      expect(failed.code).toBe(1);
      expect(currentTree(machine)).toBeNull();
      expect(trees(machine)).toEqual([]);
      expect(existsSync(pluginsPath(machine, 'package.json'))).toBe(false);
      const result = await machine.exec(['setup', '--profile', TWO]);
      expect(result.code, result.stderr).toBe(0);
      const out = plain(result.stdout);
      expect(out).toMatch(/\(npm install\)$/m);
      expect(out).not.toContain('missing');
      expect(trees(machine)).toEqual([currentTree(machine)]);
      expect(existsSync(join(machine.configDir, 'profile.json'))).toBe(true);
    }));
});
