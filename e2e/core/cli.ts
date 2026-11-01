/**
 * The test kit for e2e/core. Every test starts on a new machine: `cli` has its own config dir,
 * HOME, npm cache and npm userconfig, AGENTAGE_EXTENSIONS=1, and its own loopback site, which is
 * also the account (`cli.site`). Shared, read-only: the loopback npm registry serving the
 * fixtures. `anotherMachine(env)` adds a machine of the same account.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import {
  assertCliBuilt,
  createCliMachine,
  plain,
  type CliMachine,
  type SetupProcess,
} from '../helpers.js';
import { startFixtureRegistry } from '../registry/registry.js';
import { startStubSite, stubEnv, type StubSite } from '../stub/auth-server.js';
import { signInVia, type SignInRun } from '../stub/client.js';
import { configFiles, fixtureCopy, hashTree, type ConfigFiles } from './files.js';
import { siteOf, type Site } from './site.js';

export { expect };

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
  // stdout split into lines, colours stripped, trailing spaces trimmed.
  lines: string[];
}

// Extensions by short fixture name (`hello` for `@agentage/fixture-hello`) or full package name.
export interface ProfileSpec {
  extensions: Record<string, string>;
  // Turned off on this machine; machine.json is written first when absent.
  off?: string[];
  // Added to `@agentage` -> the loopback registry.
  registries?: Record<string, string>;
  // The shared `config`, by extension id.
  config?: Record<string, Record<string, unknown>>;
}

// file, json, write, remove, exists, list: paths relative to the config dir (AGENTAGE_CONFIG_DIR).
export interface Machine extends ConfigFiles {
  // The loopback npm registry the profiles send `@agentage` to.
  registry: string;
  // One command line, split on spaces (no shell); `env` is added for this run, undefined unsets.
  run: (command: string, env?: NodeJS.ProcessEnv) => Promise<Run>;
  start: (command: string) => SetupProcess;
  signIn: () => Promise<SignInRun>;
  // Writes a profile file outside the config dir and returns its path, for `setup --profile`.
  profile: (spec: ProfileSpec) => string;
  // A copy of fixtures/extension-<name> outside the config dir, for `extension install <path>`.
  fixture: (name: string, edits?: Record<string, string>) => string;
  snapshot: () => Record<string, string>;
  homeFiles: () => string[];
  // The account this machine signs in to: what the CLI sent it, and what it holds.
  site: Omit<Site, 'store'> & {
    // Stores a profile in the account as `profile()` writes one to a file; returns its etag.
    store: (spec: ProfileSpec) => string;
  };
}

// `hello` -> `@agentage/fixture-hello`; a scoped name stays as written.
const pkg = (name: string): string => (name.startsWith('@') ? name : `@agentage/fixture-${name}`);

const words = (command: string): string[] => command.split(' ').filter((w) => w !== '');

const toRun = (r: { code: number; stdout: string; stderr: string }): Run => ({
  code: r.code,
  stdout: r.stdout,
  stderr: r.stderr,
  lines: plain(r.stdout)
    .split('\n')
    .map((l) => l.trimEnd()),
});

const expand = (map: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).map(([name, value]) => [pkg(name), value]));

const E2E_MACHINE = {
  id: 'm_0000beef',
  name: 'e2e-box',
  dev: {},
  profileSource: 'default',
  accountId: null,
  profileEtag: null,
};

// A profile document: `@agentage` from the loopback registry, short names expanded.
const profileDoc = (registry: string, files: ConfigFiles) => {
  const machineId = (): string => {
    if (!files.exists('machine.json')) files.write('machine.json', E2E_MACHINE);
    return String(files.json('machine.json')['id']);
  };
  return ({ extensions, off, registries, config = {} }: ProfileSpec) => ({
    version: 1,
    extensions: expand(extensions),
    registries: { '@agentage': registry, ...registries },
    config,
    machines: off ? { [machineId()]: { off: off.map(pkg) } } : {},
  });
};

// Profile files sit beside the machine, outside its config dir and HOME.
const profileWriter = (scratch: string, docOf: ReturnType<typeof profileDoc>) => {
  let count = 0;
  return (spec: ProfileSpec): string => {
    const path = join(scratch, `profile-${++count}.json`);
    writeFileSync(path, JSON.stringify(docOf(spec), null, 2));
    return path;
  };
};

const accountOf = (site: StubSite, docOf: ReturnType<typeof profileDoc>): Machine['site'] => {
  const view = siteOf(site);
  return {
    ...view,
    store: (spec) => view.store(docOf(spec)),
    conflict: (...pushes) => view.conflict(...pushes.map(expand)),
  };
};

const machine = (host: CliMachine, scratch: string, registry: string, site: StubSite): Machine => {
  const files = configFiles(host.configDir);
  const docOf = profileDoc(registry, files);
  return {
    registry,
    run: async (command, env = {}) => toRun(await host.exec(words(command), 90_000, env)),
    start: (command) => host.startSetup(words(command)),
    signIn: () => signInVia(host),
    profile: profileWriter(scratch, docOf),
    fixture: fixtureCopy(scratch),
    ...files,
    snapshot: () => hashTree(host.configDir),
    homeFiles: () => readdirSync(host.home),
    site: accountOf(site, docOf),
  };
};

// A new machine: config dir and HOME from createCliMachine, plus its own npm cache and
// userconfig outside HOME, so a spec can assert HOME stays empty.
const newMachine = (site: StubSite, registry: string, env: NodeJS.ProcessEnv) => {
  const scratch = mkdtempSync(join(tmpdir(), 'agentage-e2e-npm-'));
  const host = createCliMachine({
    ...stubEnv(site),
    AGENTAGE_EXTENSIONS: '1',
    AGENTAGE_EXTENSIONS_DIR: undefined,
    npm_config_cache: join(scratch, 'cache'),
    npm_config_userconfig: join(scratch, 'npmrc'),
    ...env,
  });
  const cleanup = (): void => {
    host.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  };
  return { cli: machine(host, scratch, registry, site), cleanup };
};

export const test = base.extend<
  { site: StubSite; anotherMachine: (env?: NodeJS.ProcessEnv) => Machine; cli: Machine },
  { registry: string }
>({
  registry: [
    async ({}, use) => {
      assertCliBuilt();
      const root = mkdtempSync(join(tmpdir(), 'agentage-e2e-registry-'));
      const registry = await startFixtureRegistry(root);
      await use(registry.url);
      await registry.close();
      rmSync(root, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  // Per test: the stub keeps clients, codes and tokens.
  site: async ({}, use) => {
    const site = await startStubSite();
    await use(site);
    await site.close();
  },
  anotherMachine: async ({ site, registry }, use) => {
    const machines: { cleanup: () => void }[] = [];
    await use((env = {}) => {
      const made = newMachine(site, registry, env);
      machines.push(made);
      return made.cli;
    });
    for (const made of machines) made.cleanup();
  },
  cli: async ({ anotherMachine }, use) => use(anotherMachine()),
});
