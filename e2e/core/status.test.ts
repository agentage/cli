/**
 * @offline - `status` with AGENTAGE_PLUGINS=1 over a hand-placed plugins tree and a
 * profile.json: every static state, versions read from the tree, nothing loaded, and
 * machine.json as the only file written. The site is the loopback stub, so nothing leaves.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, plain, type CliMachine } from '../helpers.js';
import { startStubSite, stubEnv, type StubSite } from '../stub/auth-server.js';
import {
  DUP,
  fixtureVersion,
  HELLO,
  LAST_RUN,
  MACHINE_ID,
  OLD,
  seed,
  snapshot,
  withoutMachine,
  WORLD,
} from './plugin-tree.js';

interface Row {
  id: string | null;
  package: string;
  installed: string | null;
  wanted: string | null;
  state: string;
  error: string | null;
  commands: string[];
  lastRun: { at: string; state: string; error: string | null } | null;
}

interface PluginsReport {
  machine: { id: string; name: string };
  profile: { state: string; version?: number };
  plugins: Row[];
}

let stub: StubSite;

const pluginsMachine = (): CliMachine =>
  createCliMachine({ ...stubEnv(stub), AGENTAGE_PLUGINS: '1', AGENTAGE_PLUGINS_DIR: undefined });

const statusReport = async (machine: CliMachine): Promise<PluginsReport> => {
  const result = await machine.exec(['status', '--json']);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as PluginsReport;
};

const row = (report: PluginsReport, pkg: string): Row | undefined =>
  report.plugins.find((r) => r.package === pkg);

const THREE = { [HELLO]: '^1.0.0', [WORLD]: '^1', [OLD]: '^1.0.0' };

test.beforeAll(async () => {
  assertCliBuilt();
  stub = await startStubSite();
});

test.afterAll(async () => {
  await stub.close();
});

test.describe('core status @offline', () => {
  test('no profile prints "no profile", exits 0, and --json has plugins: [] @smoke', async () => {
    const machine = pluginsMachine();
    try {
      const human = await machine.exec(['status']);
      expect(human.code, human.stderr).toBe(0);
      expect(plain(human.stdout)).toMatch(/^profile\s+no profile$/m);
      const report = await statusReport(machine);
      expect(report).toMatchObject({ profile: { state: 'missing' }, plugins: [] });
      expect(report.machine.id).toMatch(/^m_[0-9a-f]{8}$/);
      expect(readdirSync(machine.configDir)).toEqual(['machine.json']);
      expect(readdirSync(machine.home)).toEqual([]);
    } finally {
      machine.cleanup();
    }
  });

  test('rows come from the tree manifests and the state file @p0', async () => {
    const machine = pluginsMachine();
    try {
      seed(machine.configDir, THREE);
      const report = await statusReport(machine);
      expect(report.machine).toEqual({ id: MACHINE_ID, name: 'e2e-box' });
      expect(report.profile).toMatchObject({ state: 'ok', version: 1 });
      expect(report.plugins.map((r) => [r.id, r.state, r.installed])).toEqual([
        ['hello', 'installed', fixtureVersion('hello')],
        ['oldengine', 'invalid', fixtureVersion('old-engine')],
        ['world', 'installed', fixtureVersion('world')],
      ]);
      const lastRun = { at: LAST_RUN.at, state: 'ok', error: null };
      expect(row(report, HELLO)).toMatchObject({ wanted: '^1.0.0', commands: ['hello'], lastRun });
      expect(row(report, WORLD)).toMatchObject({ commands: ['world'], lastRun: null });
      expect(row(report, OLD)?.error).toContain('engines.agentage "^0.1" does not match');
    } finally {
      machine.cleanup();
    }
  });

  test('nothing is loaded and machine.json is the only file written @p0', async () => {
    const machine = pluginsMachine();
    try {
      seed(machine.configDir, THREE);
      const before = snapshot(machine.configDir);
      expect((await machine.exec(['status'])).code).toBe(0);
      expect(readdirSync(join(machine.configDir, 'state'))).toEqual(['hello.json']);
      expect(withoutMachine(snapshot(machine.configDir))).toEqual(withoutMachine(before));
      const machineFile = join(machine.configDir, 'machine.json');
      const legacyKept = { id: MACHINE_ID, name: 'e2e-box', dev: {}, profileSource: 'default' };
      expect(JSON.parse(readFileSync(machineFile, 'utf-8'))).toEqual(legacyKept);
      expect(statSync(machineFile).mode & 0o777).toBe(0o600);
      expect(readdirSync(machine.home)).toEqual([]);
    } finally {
      machine.cleanup();
    }
  });

  test('off on this machine blocks the dependent, naming the peer @p0', async () => {
    const machine = pluginsMachine();
    try {
      seed(machine.configDir, { [HELLO]: '^1', [WORLD]: '^1' }, [HELLO]);
      const report = await statusReport(machine);
      expect(report.plugins.map((r) => [r.id, r.state, r.error])).toEqual([
        ['hello', 'off', null],
        ['world', 'blocked', `peer ${HELLO} is off`],
      ]);
      const human = plain((await machine.exec(['status'])).stdout);
      expect(human).toMatch(/^machine\s+m_0000beef \(e2e-box\)$/m);
      expect(human).toMatch(
        /^\s+world\s+blocked\s+@agentage\/fixture-world 1\.0\.0 \(wants \^1\)/m
      );
    } finally {
      machine.cleanup();
    }
  });

  test('a duplicate id marks both claimants invalid @p0', async () => {
    const machine = pluginsMachine();
    try {
      seed(machine.configDir, { [HELLO]: '^1', [DUP]: '^1', [WORLD]: '^1' });
      const report = await statusReport(machine);
      expect(row(report, HELLO)).toMatchObject({ state: 'invalid', lastRun: null });
      expect(row(report, HELLO)?.error).toContain('duplicate id "hello"');
      expect(row(report, DUP)?.state).toBe('invalid');
      expect(row(report, WORLD)).toMatchObject({
        state: 'blocked',
        error: `peer ${HELLO} is invalid`,
      });
    } finally {
      machine.cleanup();
    }
  });

  test('an invalid profile still prints the report, then exits 1 naming the path @p0', async () => {
    const machine = pluginsMachine();
    try {
      seed(machine.configDir, { [HELLO]: 'file:../hello' });
      const result = await machine.exec(['status', '--json']);
      expect(result.code).toBe(1);
      const report = JSON.parse(result.stdout) as PluginsReport;
      expect(report).toMatchObject({ profile: { state: 'invalid' }, plugins: [] });
      expect(result.stderr).toContain(`plugins["${HELLO}"]: file: specs are refused`);
    } finally {
      machine.cleanup();
    }
  });

  test('without AGENTAGE_PLUGINS the report and the config dir are untouched @p0', async () => {
    const machine = createCliMachine({ ...stubEnv(stub), AGENTAGE_PLUGINS: undefined });
    try {
      seed(machine.configDir, { [HELLO]: '^1' });
      const before = snapshot(machine.configDir);
      const result = await machine.exec(['status', '--json']);
      expect(result.code, result.stderr).toBe(0);
      const keys = Object.keys(JSON.parse(result.stdout) as object);
      expect(keys).toEqual(['version', 'fqdn', 'env', 'target', 'auth', 'endpoint', 'update']);
      const human = await machine.exec(['status']);
      expect(plain(human.stdout)).not.toMatch(/^(machine|profile|plugins)\s/m);
      expect(snapshot(machine.configDir)).toEqual(before);
    } finally {
      machine.cleanup();
    }
  });
});
