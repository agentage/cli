/**
 * The test kit for e2e/core. Every test starts on a new machine: `cli` has its own config dir,
 * HOME, npm cache and npm userconfig, and its own loopback site, which is also the account
 * (`cli.site`), and its own loopback npm registry serving the fixtures (`cli.registry`), packed
 * once per worker. `anotherMachine(env)` adds a machine of the same account and registry.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
import { packFixtures } from '../registry/registry.js';
import { startStubSite, stubEnv, type StubSite } from '../stub/auth-server.js';
import { signInVia, type SignInRun } from '../stub/client.js';
import { configFiles, fixtureCopy, hashTree, type ConfigFiles } from './files.js';
import { expand, profileDoc, profileWriter, type ProfileSpec } from './profiles.js';
import { testRegistry, type TestRegistry } from './registry.js';
import { siteOf, type Site } from './site.js';

export { expect };
export type { ProfileSpec };

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
  // stdout split into lines, colours stripped, trailing spaces trimmed.
  lines: string[];
}

// file, json, write, remove, exists, list: paths relative to the config dir (AGENTAGE_CONFIG_DIR).
export interface Machine extends ConfigFiles {
  // The loopback npm registry the profiles send `@agentage` to: its `url`, and `publish`.
  registry: TestRegistry;
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

const words = (command: string): string[] => command.split(' ').filter((w) => w !== '');

const toRun = (r: { code: number; stdout: string; stderr: string }): Run => ({
  code: r.code,
  stdout: r.stdout,
  stderr: r.stderr,
  lines: plain(r.stdout)
    .split('\n')
    .map((l) => l.trimEnd()),
});

const accountOf = (site: StubSite, docOf: ReturnType<typeof profileDoc>): Machine['site'] => {
  const view = siteOf(site);
  return {
    ...view,
    store: (spec) => view.store(docOf(spec)),
    conflict: (...pushes) => view.conflict(...pushes.map(expand)),
  };
};

const machine = (
  host: CliMachine,
  scratch: string,
  registry: TestRegistry,
  site: StubSite
): Machine => {
  const files = configFiles(host.configDir);
  const docOf = profileDoc(registry.url, files);
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
const newMachine = (site: StubSite, registry: TestRegistry, env: NodeJS.ProcessEnv) => {
  const scratch = mkdtempSync(join(tmpdir(), 'agentage-e2e-npm-'));
  const host = createCliMachine({
    ...stubEnv(site),
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
  {
    site: StubSite;
    registry: TestRegistry;
    anotherMachine: (env?: NodeJS.ProcessEnv) => Machine;
    cli: Machine;
  },
  { packed: string }
>({
  packed: [
    async ({}, use) => {
      assertCliBuilt();
      const root = mkdtempSync(join(tmpdir(), 'agentage-e2e-registry-'));
      await use(await packFixtures(root));
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
  registry: async ({ packed }, use) => {
    const { close, ...registry } = await testRegistry(packed);
    await use(registry);
    await close();
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
