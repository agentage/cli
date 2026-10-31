/**
 * @offline - the installer's tree layout: a deterministic plugins/package.json, an immutable
 * plugins/trees/<hash>/ with its .complete marker named by plugins/current, reuse on a second
 * run, a normalized-equal lock across config dirs, and two concurrent runs serialised on
 * plugins/install.lock.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, plain, type CliMachine } from '../helpers.js';
import { startStubSite, type StubSite } from '../stub/auth-server.js';
import {
  currentTree,
  installMachine,
  loadCompareLock,
  pluginsPath,
  profileFile,
  readJsonFile,
  startFixtureRegistry,
  trees,
  type FixtureRegistry,
} from './install-harness.js';
import { HELLO, WORLD } from './plugin-tree.js';

const TWO = profileFile('two.json');

let stub: StubSite;
let registry: FixtureRegistry;

const withMachines = async (
  count: number,
  fn: (...machines: CliMachine[]) => Promise<void>
): Promise<void> => {
  const machines = Array.from({ length: count }, () => installMachine(stub, registry));
  try {
    await fn(...machines);
  } finally {
    for (const machine of machines) machine.cleanup();
  }
};

const setupTwo = async (machine: CliMachine): Promise<string> => {
  const result = await machine.exec(['setup', '--profile', TWO]);
  expect(result.code, result.stderr).toBe(0);
  return plain(result.stdout);
};

const lockOf = (machine: CliMachine): string =>
  readFileSync(pluginsPath(machine, 'package-lock.json'), 'utf-8');

test.beforeAll(async () => {
  assertCliBuilt();
  stub = await startStubSite();
  registry = await startFixtureRegistry();
});

test.afterAll(async () => {
  await registry.close();
  await stub.close();
});

test.describe('installer trees @p0 @offline', () => {
  test('writes the manifest and a complete tree, and a second run reuses it (T07)', () =>
    withMachines(1, async (machine) => {
      expect(await setupTwo(machine)).toMatch(/\(npm install\)$/m);
      expect(readJsonFile(pluginsPath(machine, 'package.json'))).toEqual({
        name: 'agentage-plugins',
        private: true,
        dependencies: { [HELLO]: '^1.0.0', [WORLD]: '^1' },
      });
      const tree = currentTree(machine) ?? '';
      expect(tree).toMatch(/^[0-9a-f]{16}$/);
      expect(trees(machine)).toEqual([tree]);
      expect(existsSync(pluginsPath(machine, 'trees', tree, '.complete'))).toBe(true);
      expect(existsSync(pluginsPath(machine, 'trees', tree, 'node_modules', HELLO))).toBe(true);
      expect(readFileSync(pluginsPath(machine, 'npm-major'), 'utf-8')).toMatch(/^\d+\n$/);
      const born = statSync(pluginsPath(machine, 'trees', tree, '.complete')).mtimeMs;
      expect(await setupTwo(machine)).toMatch(new RegExp(`in tree ${tree} \\(reused\\)$`, 'm'));
      expect(trees(machine)).toEqual([tree]);
      expect(statSync(pluginsPath(machine, 'trees', tree, '.complete')).mtimeMs).toBe(born);
    }));

  test('two config dirs get a normalized-equal lock and the same tree (T08)', () =>
    withMachines(2, async (a, b) => {
      await setupTwo(a);
      await setupTwo(b);
      const { parseLock, lockEntries, equalLocks } = await loadCompareLock();
      const lockA = parseLock(lockOf(a));
      const lockB = parseLock(lockOf(b));
      expect(lockA && lockB && equalLocks(lockA, lockB)).toBe(true);
      expect(lockEntries(lockA ?? {}).map((e) => e.split('+')[0])).toEqual([
        `${HELLO}@1.0.0`,
        `${WORLD}@1.0.0`,
      ]);
      expect(currentTree(a)).toBe(currentTree(b));
    }));

  test('two concurrent runs serialise on install.lock and share one tree (T34)', () =>
    withMachines(1, async (machine) => {
      const first = machine.startSetup(['setup', '--profile', TWO]);
      const second = machine.startSetup(['setup', '--profile', TWO]);
      const codes = await Promise.all([first.waitExit(60_000), second.waitExit(60_000)]);
      expect(codes, `${first.output()}\n---\n${second.output()}`).toEqual([0, 0]);
      const waited = [first, second].filter((p) => p.stderr().includes('waiting for another'));
      expect(waited).toHaveLength(1);
      expect(trees(machine)).toEqual([currentTree(machine)]);
      expect(existsSync(pluginsPath(machine, 'install.lock'))).toBe(false);
    }));
});
