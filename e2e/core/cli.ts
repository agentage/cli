/**
 * The test kit for e2e/core. Every test starts on a new machine: `cli` has its own config dir,
 * HOME, npm cache and npm userconfig, AGENTAGE_EXTENSIONS=1, and its own loopback site; nothing
 * survives between tests. The one thing shared is the read-only loopback npm registry serving
 * the fixture extensions. `launcherMachine(env)` makes another machine in the same test.
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
import { startFixtureRegistry } from '../registry/registry.js';
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

export interface ProfileSpec {
  // Short fixture names (`hello`, `world`, `old-engine`, `dup-id`) or full package names.
  extensions: Record<string, string>;
  // Turned off on this machine; machine.json is written first when absent.
  off?: string[];
  // Added to `@agentage` -> the loopback registry.
  registries?: Record<string, string>;
}

// file, json, write, exists, list: paths relative to the config dir (AGENTAGE_CONFIG_DIR).
export interface Launcher extends ConfigFiles {
  // The loopback npm registry the profiles send `@agentage` to.
  registry: string;
  // One command line, split on spaces (no shell), run from the repo root.
  run: (command: string) => Promise<Run>;
  start: (command: string) => SetupProcess;
  signIn: () => Promise<SignInRun>;
  // Writes a profile file outside the config dir and returns its path, for `setup --profile`.
  profile: (spec: ProfileSpec) => string;
  snapshot: () => Record<string, string>;
  homeFiles: () => string[];
}

// `hello` -> `@agentage/fixture-hello`; a scoped name stays as written.
const pkg = (name: string): string => (name.startsWith('@') ? name : `@agentage/fixture-${name}`);

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

const expand = (map: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).map(([name, value]) => [pkg(name), value]));

const configFiles = (configDir: string) => {
  const at = (path: string): string => join(configDir, path);
  return {
    file: (path: string) => readFileSync(at(path), 'utf-8').trim(),
    json: (path: string) => JSON.parse(readFileSync(at(path), 'utf-8')) as Record<string, unknown>,
    write: (path: string, value: unknown): void => {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), JSON.stringify(value, null, 2));
    },
    exists: (path: string) => existsSync(at(path)),
    list: (path: string) => (existsSync(at(path)) ? readdirSync(at(path)).sort() : []),
  };
};

type ConfigFiles = ReturnType<typeof configFiles>;

const E2E_MACHINE = { id: 'm_0000beef', name: 'e2e-box', dev: {}, profileSource: 'default' };

// Profile files sit beside the machine, outside its config dir and HOME.
const profileWriter = (scratch: string, registry: string, files: ConfigFiles) => {
  let count = 0;
  const machineId = (): string => {
    if (!files.exists('machine.json')) files.write('machine.json', E2E_MACHINE);
    return String(files.json('machine.json')['id']);
  };
  return ({ extensions, off, registries }: ProfileSpec): string => {
    const path = join(scratch, `profile-${++count}.json`);
    const doc = {
      version: 1,
      extensions: expand(extensions),
      registries: { '@agentage': registry, ...registries },
      machines: off ? { [machineId()]: { off: off.map(pkg) } } : {},
    };
    writeFileSync(path, JSON.stringify(doc, null, 2));
    return path;
  };
};

const launcher = (machine: CliMachine, scratch: string, registry: string): Launcher => {
  const files = configFiles(machine.configDir);
  return {
    registry,
    run: async (command) => toRun(await machine.exec(words(command), 90_000)),
    start: (command) => machine.startSetup(words(command)),
    signIn: () => signInVia(machine),
    profile: profileWriter(scratch, registry, files),
    ...files,
    snapshot: () => hashTree(machine.configDir),
    homeFiles: () => readdirSync(machine.home),
  };
};

// A new machine: config dir and HOME from createCliMachine, plus its own npm cache and
// userconfig outside HOME, so a spec can assert HOME stays empty.
const newMachine = (site: StubSite, registry: string, env: NodeJS.ProcessEnv) => {
  const scratch = mkdtempSync(join(tmpdir(), 'agentage-e2e-npm-'));
  const machine = createCliMachine({
    ...stubEnv(site),
    AGENTAGE_EXTENSIONS: '1',
    AGENTAGE_EXTENSIONS_DIR: undefined,
    npm_config_cache: join(scratch, 'cache'),
    npm_config_userconfig: join(scratch, 'npmrc'),
    ...env,
  });
  const cleanup = (): void => {
    machine.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  };
  return { cli: launcher(machine, scratch, registry), cleanup };
};

export const test = base.extend<
  { site: StubSite; launcherMachine: (env?: NodeJS.ProcessEnv) => Launcher; cli: Launcher },
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
  launcherMachine: async ({ site, registry }, use) => {
    const machines: { cleanup: () => void }[] = [];
    await use((env = {}) => {
      const made = newMachine(site, registry, env);
      machines.push(made);
      return made.cli;
    });
    for (const machine of machines) machine.cleanup();
  },
  cli: async ({ launcherMachine }, use) => use(launcherMachine()),
});
