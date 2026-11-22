import { type Command } from 'commander';
import type { ExtensionPackage } from '@agentage/extension/tool';
import { addJson, CliError } from '../../lib/json-output.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { runChangedRelease } from './release-changed.js';
import { execIn, imagesOf, releaseGuard, type Exec } from './release-guard.js';
import {
  attach,
  buildImages,
  fail,
  idChecks,
  npmVersion,
  onMaster,
  publish,
  PUBLISH_SECONDS,
  scoped,
  step,
  takeSecrets,
} from './release-steps.js';

export type ExtensionReleaseOptions = {
  dir?: string;
  timeout?: number;
  json?: boolean;
  changed?: boolean;
  dryRun?: boolean;
};

export interface ReleaseDeps {
  exec: (cwd: string, seconds?: number) => Exec;
  tool: LoadKitTool;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
}

const defaultDeps: ReleaseDeps = { exec: execIn, tool: loadKitTool, env: process.env };

const preflight = async (
  run: Exec,
  pkg: ExtensionPackage,
  tag: string,
  sha: string,
  isPrivate: boolean
) => {
  idChecks(pkg);
  await onMaster(run, sha);
  const v = `v${pkg.version}`;
  if (tag !== v)
    fail(`tag: ${tag} is not ${v}, the package.json version; tag the commit that sets it`);
  step(`tag: ${tag} is the package.json version`);
  if (!isPrivate) await npmVersion(run);
};

// One line per step, PASS or FAIL; any refusal exits 1 before anything is pushed or published.
export const runExtensionRelease = async (
  { dir = '.', timeout = 60 }: ExtensionReleaseOptions = {},
  deps: ReleaseDeps = defaultDeps
): Promise<unknown> => {
  const { GITHUB_REF_NAME: tag, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo } = deps.env;
  const missing = ['GITHUB_REF_NAME', 'GITHUB_SHA', 'GITHUB_REPOSITORY'].find((n) => !deps.env[n]);
  if (!tag || !sha || !repo) return fail(`inputs: ${missing} is not set; run it on a tag push`);
  const secrets = takeSecrets(deps.env);
  const pkg = await (await deps.tool()).readManifest(dir);
  const run = scoped(deps.exec(dir, timeout), secrets);
  const isPrivate = pkg['private'] === true;
  await preflight(run, pkg, tag, sha, isPrivate);
  const { id } = pkg.agentage;
  const { parts, oneImage } = imagesOf(pkg);
  const g = { dir, tag, sha, repo, id, version: pkg.version, parts, oneImage };
  const decision = await releaseGuard(g, run).catch((e: Error) => fail(`guard: ${e.message}`));
  const build = decision === 'build';
  const done = isPrivate ? 'is released' : 'is released: npm only';
  step(`guard: ${tag} ${build ? 'has no record and no image: build' : done}`);
  if (build) await attach(run, tag, repo, await buildImages(dir, oneImage, deps.tool));
  if (isPrivate) step('npm: private package, not published');
  else
    await publish(
      run,
      scoped(deps.exec(dir, PUBLISH_SECONDS), secrets),
      pkg,
      secrets['npm']?.['NPM_TOKEN']
    );
  return { id, version: pkg.version, tag, built: build, published: !isPrivate };
};

// --changed: each changed extension of the repo; with no flag: the one package of a v* tag.
export const runRelease = async (
  opts: ExtensionReleaseOptions = {},
  deps: ReleaseDeps = defaultDeps
): Promise<unknown> => {
  if (opts.changed) return runChangedRelease(opts, deps);
  if (opts.dryRun) throw new CliError('invalid_argument', '--dry-run goes with --changed');
  return runExtensionRelease(opts, deps);
};

export const addRelease = (
  group: Command,
  release: (opts: ExtensionReleaseOptions) => Promise<void>
): void => {
  addJson(
    group
      .command('release')
      .description(
        'Release an extension in CI: from its v* tag, or with --changed each changed one on a merge'
      )
      .option('--dir <path>', 'the extension package folder (default: the current folder)')
      .option(
        '--timeout <seconds>',
        'bound on each git, GitHub and npm check (default: 60; npm publish: 300)',
        Number
      )
      .option(
        '--changed',
        'each extension (root or extensions/*) whose folder changed since its last <id>@* tag; root docs/**, root *.md, .github/** and repo config (plus .release-ignore patterns) never trigger a release, package.json, the lock, src/** and Dockerfile* always do; a private repo skips npm unless the package opts in'
      )
      .option('--dry-run', 'with --changed: print what it would release, change nothing')
  ).action(release);
};
