import { requireNpm10, resolveNpmCli, runNpm, type NpmResult } from '../../lib/npm/npm-cli.js';
import { extensionsDir } from '../paths.js';

// Every package whose scope the profile's `registries` does not name comes from here.
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const NPM_TIMEOUT_MS = 10 * 60_000;
const LOOKUP_TIMEOUT_MS = 2 * 60_000;

export type NpmCommand = 'ci' | 'install' | 'update';

// The installer's one seam: unit tests play npm, everything else runs on real files.
// `packages` limits an update to those packages.
export type Npm = (command: NpmCommand, tree: string, packages?: string[]) => Promise<NpmResult>;

// pack: what one spec resolves to; view: every release of a name with its engines.
export type LookupCommand = 'pack' | 'view';

// `extension install`'s seam: what the registry has, read by npm without installing anything.
export type NpmManifest = (
  command: LookupCommand,
  spec: string,
  registries: Record<string, string>
) => Promise<NpmResult>;

// `name` keeps every version an object: npm view unwraps to bare values when the first has one field.
const LOOKUP_FLAGS: Record<LookupCommand, string[]> = {
  pack: ['--dry-run', '--json'],
  view: ['name', 'version', 'engines', '--json'],
};

// npm reads its env config case-insensitively, so either spelling may carry these paths.
const npmConfig = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const name = `npm_config_${key}`;
  const found = Object.keys(env).find((k) => k.toLowerCase() === name);
  return (found && env[found]) || null;
};

// Carried as flags: runNpm drops every npm_config_* variable from the child env.
const configFlags = (env: NodeJS.ProcessEnv): string[] => {
  const userconfig = npmConfig(env, 'userconfig');
  const cache = npmConfig(env, 'cache');
  return [
    ...(userconfig ? ['--userconfig', userconfig] : []),
    ...(cache ? ['--cache', cache] : []),
  ];
};

// Scoped registries come from the tree's own .npmrc; runNpm appends --no-audit --no-fund.
export const npmArgs = (
  command: NpmCommand,
  tree: string,
  env = process.env,
  packages: string[] = []
): string[] => [
  command,
  ...packages,
  '--prefix',
  tree,
  '--registry',
  DEFAULT_REGISTRY,
  '--ignore-scripts',
  '--no-update-notifier',
  ...configFlags(env),
];

// `--prefix` keeps a project .npmrc in the working directory out of it; scopes go as flags.
export const manifestArgs = (
  command: LookupCommand,
  spec: string,
  registries: Record<string, string>,
  prefix: string,
  env = process.env
): string[] => [
  command,
  spec,
  ...LOOKUP_FLAGS[command],
  '--ignore-scripts',
  '--prefix',
  prefix,
  '--registry',
  DEFAULT_REGISTRY,
  ...Object.entries(registries).map(([scope, url]) => `--${scope}:registry=${url}`),
  '--no-update-notifier',
  ...configFlags(env),
];

// Resolves npm-cli.js once and refuses npm below 10 before anything runs.
const checkedNpm = async (env: NodeJS.ProcessEnv) => {
  const npmCli = resolveNpmCli({ env });
  const run: typeof runNpm = (args, opts) =>
    runNpm([...args, ...configFlags(env)], { ...opts, npmCli });
  return { npmCli, version: await requireNpm10(run) };
};

const checkedNpmCli = async (env: NodeJS.ProcessEnv): Promise<string> =>
  (await checkedNpm(env)).npmCli;

// The npm major that writes the lock, pushed next to it.
export const npmMajor = async (env = process.env): Promise<number> =>
  Number.parseInt((await checkedNpm(env)).version, 10);

export const prepareNpm = async (env = process.env): Promise<Npm> => {
  const npmCli = await checkedNpmCli(env);
  return (command, tree, packages = []) =>
    runNpm(npmArgs(command, tree, env, packages), {
      cwd: tree,
      timeoutMs: NPM_TIMEOUT_MS,
      npmCli,
    });
};

export const prepareManifest = async (env = process.env): Promise<NpmManifest> => {
  const npmCli = await checkedNpmCli(env);
  return (command, spec, registries) =>
    runNpm(manifestArgs(command, spec, registries, extensionsDir(), env), {
      timeoutMs: LOOKUP_TIMEOUT_MS,
      npmCli,
    });
};
