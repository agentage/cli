/**
 * Shared setup for the installer specs: every fixture package packed with `npm pack` and
 * served by the in-process registry, a CLI machine pointed at it and at the loopback stub,
 * and readers for the plugins dir the installer writes.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';
import { createCliMachine, type CliMachine } from '../helpers.js';
import { loadNpmCli } from '../registry/npm-cli.js';
import { startRegistry } from '../registry/registry.js';
import { stubEnv, type StubSite } from '../stub/auth-server.js';
import { FIXTURES } from './plugin-tree.js';

export interface FixtureRegistry {
  url: string;
  // Outside every machine's HOME, so a test can assert HOME stays empty.
  cache: string;
  close: () => Promise<void>;
}

interface CompareLock {
  parseLock: (raw: string | null) => Record<string, unknown> | null;
  lockEntries: (lock: Record<string, unknown>) => string[];
  equalLocks: (a: Record<string, unknown>, b: Record<string, unknown>) => boolean;
}

export const profileFile = (name: string): string => join(FIXTURES, 'profiles', name);

export const startFixtureRegistry = async (): Promise<FixtureRegistry> => {
  const root = mkdtempSync(join(tmpdir(), 'agentage-fixture-registry-'));
  const packDir = join(root, 'pack');
  mkdirSync(packDir);
  const env = { npm_config_userconfig: join(root, '.npmrc'), npm_config_cache: join(root, '.npm') };
  const dirs = readdirSync(FIXTURES)
    .filter((name) => name.startsWith('plugin-'))
    .map((name) => join(FIXTURES, name));
  const { runNpm } = await loadNpmCli();
  const packed = await runNpm(['pack', ...dirs, '--pack-destination', packDir], {
    env,
    timeoutMs: 120_000,
  });
  expect(packed.code, packed.stderr).toBe(0);
  const registry = await startRegistry(packDir);
  const close = async (): Promise<void> => {
    await registry.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { url: registry.url, cache: join(root, 'npm-cache'), close };
};

export const installMachine = (
  stub: StubSite,
  registry: FixtureRegistry,
  extra: NodeJS.ProcessEnv = {}
): CliMachine =>
  createCliMachine({
    ...stubEnv(stub),
    AGENTAGE_PLUGINS: '1',
    AGENTAGE_NPM_REGISTRY: registry.url,
    AGENTAGE_PLUGINS_DIR: undefined,
    AGENTAGE_PLUGIN_SCOPES: undefined,
    npm_config_cache: registry.cache,
    ...extra,
  });

export const pluginsPath = (machine: CliMachine, ...parts: string[]): string =>
  join(machine.configDir, 'plugins', ...parts);

export const currentTree = (machine: CliMachine): string | null => {
  const path = pluginsPath(machine, 'current');
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : null;
};

export const trees = (machine: CliMachine): string[] => {
  const dir = pluginsPath(machine, 'trees');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

export const readJsonFile = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;

// The shipped dist module, by computed path so type-check:e2e never needs a build first.
export const loadCompareLock = async (): Promise<CompareLock> =>
  (await import(
    pathToFileURL(join(process.cwd(), 'dist', 'core', 'installer', 'compare-lock.js')).href
  )) as CompareLock;

// Paths the stub served since `mark` under the OAuth routes: sign-in would show up here.
export const authRequestsSince = (stub: StubSite, mark: number): string[] =>
  stub.state.requests
    .slice(mark)
    .map((r) => r.path)
    .filter((path) => path.startsWith('/api/auth/'));
