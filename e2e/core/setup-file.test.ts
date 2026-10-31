/**
 * @offline - `setup --profile <file>` with AGENTAGE_PLUGINS=1 against the in-process
 * registry: no sign-in, profile.json and machine.json written, both fixtures installed and
 * shown by `status`; `--dry-run` writes nothing; plain `setup` signs in at the loopback stub
 * and falls back to the local profile (or the default) while no cloud profile exists.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, plain, type CliMachine } from '../helpers.js';
import { startStubSite, stubEnv, type StubSite } from '../stub/auth-server.js';
import { signInVia } from '../stub/client.js';
import {
  authRequestsSince,
  currentTree,
  installMachine,
  pluginsPath,
  profileFile,
  readJsonFile,
  startFixtureRegistry,
  trees,
  type FixtureRegistry,
} from './install-harness.js';
import { fixtureVersion, HELLO, WORLD } from './plugin-tree.js';

interface Report {
  machine: { id: string };
  profile: { state: string; source?: string };
  plugins: { id: string | null; package: string; state: string; installed: string | null }[];
}

const TWO = profileFile('two.json');

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

test.beforeAll(async () => {
  assertCliBuilt();
  stub = await startStubSite();
  registry = await startFixtureRegistry();
});

test.afterAll(async () => {
  await registry.close();
  await stub.close();
});

test.describe('setup --profile @p0 @offline', () => {
  test('installs from the file without signing in, then status shows both (T02)', () =>
    withMachine(async (machine) => {
      const mark = stub.state.requests.length;
      const result = await machine.exec(['setup', '--profile', TWO]);
      expect(result.code, result.stderr).toBe(0);
      expect(authRequestsSince(stub, mark)).toEqual([]);
      expect(existsSync(join(machine.configDir, 'auth.json'))).toBe(false);
      const profilePath = join(machine.configDir, 'profile.json');
      expect(readJsonFile(profilePath)).toMatchObject(readJsonFile<Record<string, unknown>>(TWO));
      expect(statSync(profilePath).mode & 0o777).toBe(0o600);
      const machineFile = readJsonFile<{ profileSource: string }>(
        join(machine.configDir, 'machine.json')
      );
      expect(machineFile.profileSource).toBe('file');
      expect(plain(result.stdout)).toMatch(/^install\s+2 plugins in tree [0-9a-f]{16} \(npm/m);
      expect(plain(result.stdout)).toMatch(/^\s+hello\s+installed\s+@agentage\/fixture-hello/m);
      expect(readdirSync(machine.home)).toEqual([]);
      const status = await machine.exec(['status', '--json']);
      expect(status.code, status.stderr).toBe(0);
      const report = JSON.parse(status.stdout) as Report;
      expect(report.profile).toMatchObject({ state: 'ok', source: 'file' });
      expect(report.plugins.map((r) => [r.package, r.state, r.installed])).toEqual([
        [HELLO, 'installed', fixtureVersion('hello')],
        [WORLD, 'installed', fixtureVersion('world')],
      ]);
    }));

  test('--dry-run prints the plan and writes no profile and no tree (T21)', () =>
    withMachine(async (machine) => {
      const result = await machine.exec(['setup', '--profile', TWO, '--dry-run']);
      expect(result.code, result.stderr).toBe(0);
      const out = plain(result.stdout);
      expect(out).toMatch(/^dry run\s+nothing written$/m);
      expect(out).toContain(`registry   ${registry.url}`);
      expect(out).toMatch(/^\s+@agentage\/fixture-hello\s+\^1\.0\.0$/m);
      expect(out).toMatch(/^npm\s+install --ignore-scripts \(no lock yet\)$/m);
      expect(existsSync(join(machine.configDir, 'profile.json'))).toBe(false);
      expect(existsSync(pluginsPath(machine))).toBe(false);
    }));

  test('without AGENTAGE_PLUGINS, --profile stays an unknown option (exit 2)', async () => {
    const machine = createCliMachine({ ...stubEnv(stub), AGENTAGE_PLUGINS: undefined });
    try {
      const result = await machine.exec(['setup', '--profile', TWO]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("unknown option '--profile'");
      expect(readdirSync(machine.configDir)).toEqual([]);
    } finally {
      machine.cleanup();
    }
  });
});

test.describe('plain setup with plugins on @p0 @offline', () => {
  test('signs in, then uses the default profile locally and installs nothing', () =>
    withMachine(async (machine) => {
      const run = await signInVia(machine);
      expect(run.code, run.output).toBe(0);
      expect(run.stderr).toContain('cloud profile unavailable, using the default profile');
      expect(readJsonFile(join(machine.configDir, 'profile.json'))).toEqual({
        version: 1,
        plugins: {},
        config: {},
        machines: {},
      });
      expect(plain(run.output)).toMatch(/^install\s+no plugins in tree \S+ \(npm skipped\)$/m);
      expect(trees(machine)).toEqual([currentTree(machine)]);
      expect(readdirSync(pluginsPath(machine, 'trees', currentTree(machine) ?? ''))).toEqual([
        '.complete',
        'package.json',
      ]);
    }));

  test('after --profile, plain setup installs from the local profile.json', () =>
    withMachine(async (machine) => {
      expect((await signInVia(machine)).code).toBe(0);
      expect((await machine.exec(['setup', '--profile', TWO])).code).toBe(0);
      const tree = currentTree(machine);
      const again = await machine.exec(['setup', '--no-browser']);
      expect(again.code, again.stderr).toBe(0);
      expect(again.stderr).toContain('cloud profile unavailable, using local profile.json');
      expect(plain(again.stdout)).toMatch(/^install\s+2 plugins in tree \S+ \(reused\)$/m);
      expect(plain(again.stdout)).toMatch(/^\s+world\s+installed\s+@agentage\/fixture-world/m);
      expect(currentTree(machine)).toBe(tree);
    }));
});
