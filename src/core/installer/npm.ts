import { requireNpm10, resolveNpmCli, runNpm, type NpmResult } from '../../lib/npm/npm-cli.js';

// Every package whose scope the profile's `registries` does not name comes from here.
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const NPM_TIMEOUT_MS = 10 * 60_000;

export type NpmCommand = 'ci' | 'install';

// The installer's one seam: unit tests play npm, everything else runs on real files.
export type Npm = (command: NpmCommand, tree: string) => Promise<NpmResult>;

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
export const npmArgs = (command: NpmCommand, tree: string, env = process.env): string[] => [
  command,
  '--prefix',
  tree,
  '--registry',
  DEFAULT_REGISTRY,
  '--ignore-scripts',
  '--no-update-notifier',
  ...configFlags(env),
];

// Resolves npm-cli.js once and refuses npm below 10 before any tree is staged.
export const prepareNpm = async (env = process.env): Promise<Npm> => {
  const npmCli = resolveNpmCli({ env });
  await requireNpm10((args, opts) => runNpm([...args, ...configFlags(env)], { ...opts, npmCli }));
  return (command, tree) =>
    runNpm(npmArgs(command, tree, env), { cwd: tree, timeoutMs: NPM_TIMEOUT_MS, npmCli });
};
