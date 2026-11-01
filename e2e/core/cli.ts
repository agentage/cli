/**
 * The test kit for e2e/core: every spec gets `cli`, a fresh machine (throwaway config dir and
 * HOME, AGENTAGE_EXTENSIONS=1) wired to a loopback site and a loopback npm registry that serves
 * the fixture extensions. `launcherMachine(env)` makes another one, e.g. a second machine or the
 * flag off.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import {
  assertCliBuilt,
  createCliMachine,
  plain,
  type CliMachine,
  type SetupProcess,
} from '../helpers.js';
import { loadNpmCli } from '../registry/npm-cli.js';
import { startRegistry } from '../registry/registry.js';
import { startStubSite, stubEnv, type StubSite } from '../stub/auth-server.js';
import { signInVia, type SignInRun } from '../stub/client.js';

export { expect };

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
  // stdout split into lines, colours stripped, trailing spaces trimmed.
  lines: string[];
}

export interface Launcher {
  registry: { url: string };
  // One command line, split on spaces (no shell), run from the repo root.
  run: (command: string) => Promise<Run>;
  start: (command: string) => SetupProcess;
  signIn: () => Promise<SignInRun>;
  // Paths below are relative to the config dir (AGENTAGE_CONFIG_DIR).
  file: (path: string) => string;
  json: (path: string) => Record<string, unknown>;
  write: (path: string, value: unknown) => void;
  exists: (path: string) => boolean;
  list: (path: string) => string[];
  snapshot: () => Record<string, string>;
  homeFiles: () => string[];
}

interface Site {
  stub: StubSite;
  registry: string;
  npmCache: string;
}

const FIXTURES = join(process.cwd(), 'fixtures');

// Every fixture extension packed with `npm pack` and served on loopback, once per worker.
const startSite = async (root: string): Promise<Site & { close: () => Promise<void> }> => {
  const packDir = join(root, 'pack');
  mkdirSync(packDir);
  const dirs = readdirSync(FIXTURES).filter((n) => n.startsWith('extension-'));
  const env = { npm_config_userconfig: join(root, '.npmrc'), npm_config_cache: join(root, '.npm') };
  const { runNpm } = await loadNpmCli();
  const packArgs = ['pack', ...dirs.map((d) => join(FIXTURES, d)), '--pack-destination', packDir];
  const packed = await runNpm(packArgs, { env, timeoutMs: 120_000 });
  expect(packed.code, packed.stderr).toBe(0);
  const [stub, registry] = await Promise.all([startStubSite(), startRegistry(packDir)]);
  const close = async (): Promise<void> => {
    await Promise.all([stub.close(), registry.close()]);
  };
  return { stub, registry: registry.url, npmCache: join(root, 'npm-cache'), close };
};

const machineEnv = (site: Site, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...stubEnv(site.stub),
  AGENTAGE_EXTENSIONS: '1',
  AGENTAGE_NPM_REGISTRY: site.registry,
  AGENTAGE_EXTENSIONS_DIR: undefined,
  AGENTAGE_EXTENSION_SCOPES: undefined,
  // Shared and outside HOME, so a spec can assert HOME stays empty.
  npm_config_cache: site.npmCache,
  ...env,
});

// update-check.json is the CLI's own update throttle, which any command may refresh.
const hashTree = (dir: string, prefix = ''): Record<string, string> =>
  Object.assign(
    {},
    ...readdirSync(dir, { withFileTypes: true }).map((e) => {
      if (e.name === 'update-check.json') return {};
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) return { [rel]: 'dir', ...hashTree(join(dir, e.name), `${rel}/`) };
      return {
        [rel]: createHash('sha256')
          .update(readFileSync(join(dir, e.name)))
          .digest('hex'),
      };
    })
  );

const words = (command: string): string[] => command.split(' ').filter((w) => w !== '');

const toRun = (r: { code: number; stdout: string; stderr: string }): Run => ({
  code: r.code,
  stdout: r.stdout,
  stderr: r.stderr,
  lines: plain(r.stdout)
    .split('\n')
    .map((l) => l.trimEnd()),
});

const launcher = (machine: CliMachine, site: Site): Launcher => {
  const at = (path: string): string => join(machine.configDir, path);
  return {
    registry: { url: site.registry },
    run: async (command) => toRun(await machine.exec(words(command), 90_000)),
    start: (command) => machine.startSetup(words(command)),
    signIn: () => signInVia(machine),
    file: (path) => readFileSync(at(path), 'utf-8').trim(),
    json: (path) => JSON.parse(readFileSync(at(path), 'utf-8')) as Record<string, unknown>,
    write: (path, value) => {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), JSON.stringify(value, null, 2));
    },
    exists: (path) => existsSync(at(path)),
    list: (path) => (existsSync(at(path)) ? readdirSync(at(path)).sort() : []),
    snapshot: () => hashTree(machine.configDir),
    homeFiles: () => readdirSync(machine.home),
  };
};

export const test = base.extend<
  { cli: Launcher; launcherMachine: (env?: NodeJS.ProcessEnv) => Launcher },
  { site: Site }
>({
  site: [
    async ({}, use) => {
      assertCliBuilt();
      const root = mkdtempSync(join(tmpdir(), 'agentage-e2e-site-'));
      const site = await startSite(root);
      await use(site);
      await site.close();
      rmSync(root, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  launcherMachine: async ({ site }, use) => {
    const machines: CliMachine[] = [];
    await use((env = {}) => {
      const machine = createCliMachine(machineEnv(site, env));
      machines.push(machine);
      return launcher(machine, site);
    });
    for (const machine of machines) machine.cleanup();
  },
  cli: async ({ launcherMachine }, use) => use(launcherMachine()),
});
