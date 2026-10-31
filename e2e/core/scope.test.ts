/**
 * @offline - profiles the installer refuses before anything is written: a package outside
 * the allowed scopes and a `file:` spec, each named with the rule it broke.
 * AGENTAGE_PLUGIN_SCOPES widens the scope rule.
 */
import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, plain, type CliMachine } from '../helpers.js';
import { startStubSite, type StubSite } from '../stub/auth-server.js';
import {
  installMachine,
  profileFile,
  startFixtureRegistry,
  type FixtureRegistry,
} from './install-harness.js';

let stub: StubSite;
let registry: FixtureRegistry;

const withMachine = async (
  fn: (machine: CliMachine) => Promise<void>,
  extra: NodeJS.ProcessEnv = {}
): Promise<void> => {
  const machine = installMachine(stub, registry, extra);
  try {
    await fn(machine);
  } finally {
    machine.cleanup();
  }
};

// Only the update-check cache may appear: no profile, no machine.json, no plugins dir.
const nothingWritten = (machine: CliMachine): void => {
  const written = readdirSync(machine.configDir).filter((f) => f !== 'update-check.json');
  expect(written).toEqual([]);
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

test.describe('installer refusals @p0 @offline', () => {
  test('a name outside @agentage is refused naming the plugin and the scope rule (T09)', () =>
    withMachine(async (machine) => {
      const result = await machine.exec(['setup', '--profile', profileFile('scope-bad.json')]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('plugins["@acme/fixture-hello"]: refused by the scope rule');
      expect(result.stderr).not.toContain('@agentage/fixture-hello"]');
      nothingWritten(machine);
    }));

  test('a file: spec is refused naming the plugin and the spec rule (T09)', () =>
    withMachine(async (machine) => {
      const result = await machine.exec(['setup', '--profile', profileFile('spec-bad.json')]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'plugins["@agentage/fixture-hello"]: file: specs are refused'
      );
      nothingWritten(machine);
    }));

  test('AGENTAGE_PLUGIN_SCOPES widens the scope rule', () =>
    withMachine(
      async (machine) => {
        const args = ['setup', '--profile', profileFile('scope-bad.json'), '--dry-run'];
        const result = await machine.exec(args);
        expect(result.code, result.stderr).toBe(0);
        expect(plain(result.stdout)).toMatch(/^\s+@acme\/fixture-hello\s+\^1\.0\.0$/m);
        nothingWritten(machine);
      },
      { AGENTAGE_PLUGIN_SCOPES: '@acme' }
    ));
});
