import {
  requireNpm10,
  resolveNpmCli,
  runNpm,
  type NpmResult,
  type ResolveNpmOptions,
  type RunNpmOptions,
} from '../../lib/npm/npm-cli.js';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
export const DEFAULT_NPM_TIMEOUT_MS = 10 * 60_000;

export type NpmCommand = 'ci' | 'install';

export interface NpmSettings {
  registry: string;
  timeoutMs: number;
  // Carried as flags: the child env loses every npm_config_* variable.
  userconfig: string | null;
  cache: string | null;
}

export interface InstallerNpm {
  run: (command: NpmCommand, tree: string) => Promise<NpmResult>;
}

export interface NpmDeps {
  env: NodeJS.ProcessEnv;
  execPath: string;
  resolveCli: (opts: ResolveNpmOptions) => string;
  run: (args: string[], opts: RunNpmOptions) => Promise<NpmResult>;
}

const defaultDeps: NpmDeps = {
  env: process.env,
  execPath: process.execPath,
  resolveCli: resolveNpmCli,
  run: runNpm,
};

// npm reads its env config case-insensitively, so either spelling may carry the test paths.
const npmConfig = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const name = `npm_config_${key}`;
  const found = Object.keys(env).find((k) => k.toLowerCase() === name);
  return (found && env[found]) || null;
};

const registryOf = (env: NodeJS.ProcessEnv): string => {
  const raw = env['AGENTAGE_NPM_REGISTRY'] || DEFAULT_REGISTRY;
  if (!/^https?:\/\/[^/]/i.test(raw)) throw new Error(`AGENTAGE_NPM_REGISTRY is not a URL: ${raw}`);
  return raw.replace(/\/+$/, '');
};

const timeoutOf = (env: NodeJS.ProcessEnv): number => {
  const ms = Number(env['AGENTAGE_NPM_TIMEOUT_MS']);
  return Number.isInteger(ms) && ms > 0 ? ms : DEFAULT_NPM_TIMEOUT_MS;
};

export const npmSettings = (env: NodeJS.ProcessEnv = process.env): NpmSettings => ({
  registry: registryOf(env),
  timeoutMs: timeoutOf(env),
  userconfig: npmConfig(env, 'userconfig'),
  cache: npmConfig(env, 'cache'),
});

const configFlags = (s: NpmSettings): string[] => [
  ...(s.userconfig ? ['--userconfig', s.userconfig] : []),
  ...(s.cache ? ['--cache', s.cache] : []),
];

// runNpm appends --no-audit --no-fund to every call.
export const npmArgs = (command: NpmCommand, tree: string, s: NpmSettings): string[] => [
  command,
  '--prefix',
  tree,
  '--registry',
  s.registry,
  '--ignore-scripts',
  '--no-update-notifier',
  ...configFlags(s),
];

// Resolves npm-cli.js once and refuses npm below 10 before any tree is staged.
export const prepareNpm = async (
  s: NpmSettings,
  deps: NpmDeps = defaultDeps
): Promise<InstallerNpm> => {
  const npmCli = deps.resolveCli({ execPath: deps.execPath, env: deps.env });
  const run = (args: string[], opts: RunNpmOptions): Promise<NpmResult> =>
    deps.run(args, { ...opts, npmCli });
  await requireNpm10((args, opts) => run([...args, ...configFlags(s)], opts));
  return {
    run: (command, tree) => run(npmArgs(command, tree, s), { cwd: tree, timeoutMs: s.timeoutMs }),
  };
};
