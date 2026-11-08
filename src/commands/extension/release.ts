import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Command } from 'commander';
import type { ExtensionPackage } from '@agentage/extension/tool';
import { runExtensionBuild } from './build.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { execIn, IMAGE_PARTS, RECORD, releaseGuard, type Exec } from './release-guard.js';

export type ExtensionReleaseOptions = { dir?: string; timeout?: number };

export interface ReleaseDeps {
  exec: (cwd: string, seconds?: number) => Exec;
  tool: LoadKitTool;
  env: NodeJS.ProcessEnv;
}

const defaultDeps: ReleaseDeps = { exec: execIn, tool: loadKitTool, env: process.env };

const step = (line: string): void => console.log(`PASS ${line}`);

const fail = (line: string): never => {
  throw new Error(`FAIL ${line}`);
};

// Tokens leave the environment, so docker build and npm lifecycle scripts never see them.
const takeSecrets = (env: NodeJS.ProcessEnv): Record<string, NodeJS.ProcessEnv> => {
  const { GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN } = env;
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN']) delete env[name];
  const gh = GH_TOKEN ?? GITHUB_TOKEN;
  return { gh: gh ? { GH_TOKEN: gh } : {}, npm: NPM_TOKEN ? { NPM_TOKEN } : {} };
};

const scoped =
  (exec: Exec, secrets: Record<string, NodeJS.ProcessEnv>): Exec =>
  (cmd, args) =>
    exec(cmd, args, secrets[cmd]);

const imageParts = (pkg: ExtensionPackage) =>
  IMAGE_PARTS.filter((part) => (pkg.agentage.parts[part] ?? false) !== false);

// The record by digest on the tag's release; the release is created when the tag has none.
const attach = async (run: Exec, tag: string, repo: string): Promise<void> => {
  const file = join('dist', RECORD);
  const exists = (await run('gh', ['release', 'view', tag, '-R', repo])).ok;
  const notes = ['--title', tag, '--notes', `Images by digest: ${RECORD}`];
  const args = exists ? ['upload', tag, file] : ['create', tag, file, ...notes];
  const ran = await run('gh', ['release', ...args, '-R', repo]);
  if (!ran.ok) fail(`record: ${ran.err}`);
  step(`record: ${RECORD} attached to release ${tag}`);
};

// Single quotes on purpose: npm expands ${NPM_TOKEN} itself, the token never lands on disk.
const tokenConfig = async (token?: string): Promise<string[]> => {
  if (!token) return [];
  const file = join(await mkdtemp(join(tmpdir(), 'agentage-npm-')), '.npmrc');
  await writeFile(file, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n');
  return ['--userconfig', file];
};

// Only E404 means "not on npm"; a registry that cannot answer stops the release, never publishes.
const onNpm = async (run: Exec, args: string[], what: string): Promise<boolean> => {
  const viewed = await run('npm', ['view', ...args]);
  if (viewed.ok) return viewed.out.trim() !== '';
  if (!/E404/.test(viewed.err)) fail(`npm: cannot tell whether ${what} is on npm: ${viewed.err}`);
  return false;
};

// The upload with provenance signs first: its own bound, longer than the checks.
const PUBLISH_SECONDS = 300;

// A killed publish may have landed: stop, never stage it again; a re-run reads "already on npm".
const direct = async (push: Exec, spec: string, flags: string[]): Promise<boolean> => {
  const published = await push('npm', ['publish', ...flags]);
  if (/timed out after/.test(published.err))
    fail(
      `npm: publish of ${spec} ${published.err}; re-run the release: it reads "already on npm" if the upload landed`
    );
  return published.ok;
};

// OIDC trusted publishing; a new name (NPM_TOKEN set) or an unauthorized direct publish is staged.
const publish = async (
  run: Exec,
  push: Exec,
  { name, version }: ExtensionPackage,
  token?: string
) => {
  const cfg = await tokenConfig(token);
  const spec = `${name}@${version}`;
  if (await onNpm(run, [spec, 'version', ...cfg], spec))
    return step(`npm: ${spec} is already on npm`);
  const flags = ['--access', 'public', '--provenance', '--ignore-scripts', ...cfg];
  const fresh = token !== undefined && !(await onNpm(run, [name, 'name', ...cfg], name));
  if (!fresh && (await direct(push, spec, flags))) return step(`npm: ${spec} published`);
  const staged = await push('npm', ['stage', 'publish', ...flags]);
  if (!staged.ok) fail(`npm: ${staged.err}`);
  const why = fresh
    ? 'a new name has no trusted publisher'
    : 'direct publish not authorized: no validated trusted publisher';
  step(`npm: ${spec} staged for approval (${why})`);
};

const npmVersion = async (run: Exec): Promise<void> => {
  const v = (await run('npm', ['--version'])).out.trim();
  const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
  if (major * 1e6 + minor * 1e3 + patch < 11_005_001)
    fail(`npm: npm ${v} cannot publish with OIDC: needs npm >= 11.5.1`);
  step(`npm: npm ${v}`);
};

const preflight = async (
  run: Exec,
  pkg: ExtensionPackage,
  tag: string,
  sha: string,
  isPrivate: boolean
) => {
  if (pkg.agentage.id === 'template')
    fail('id: this repo is the starting point for extensions: create one, release that');
  step(`id: ${pkg.agentage.id} is not the template`);
  const fetched = await run('git', ['fetch', '-q', 'origin', 'master']);
  if (!fetched.ok || !(await run('git', ['merge-base', '--is-ancestor', sha, 'origin/master'])).ok)
    fail(`master: ${sha} is not on master${fetched.err ? `: ${fetched.err}` : ''}`);
  step(`master: ${sha} is on master`);
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
): Promise<void> => {
  const { GITHUB_REF_NAME: tag, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo } = deps.env;
  const missing = ['GITHUB_REF_NAME', 'GITHUB_SHA', 'GITHUB_REPOSITORY'].find((n) => !deps.env[n]);
  if (!tag || !sha || !repo) return fail(`inputs: ${missing} is not set; run it on a tag push`);
  const secrets = takeSecrets(deps.env);
  const pkg = await (await deps.tool()).readManifest(dir);
  const run = scoped(deps.exec(dir, timeout), secrets);
  const isPrivate = pkg['private'] === true;
  await preflight(run, pkg, tag, sha, isPrivate);
  const { id } = pkg.agentage;
  const g = { dir, tag, sha, repo, id, version: pkg.version, parts: imageParts(pkg) };
  const decision = await releaseGuard(g, run).catch((e: Error) => fail(`guard: ${e.message}`));
  const build = decision === 'build';
  const done = isPrivate ? 'is released' : 'is released: npm only';
  step(`guard: ${tag} ${build ? 'has no record and no image: build' : done}`);
  if (build) {
    await runExtensionBuild({ push: true, dir }, deps.tool);
    await attach(run, tag, repo);
  }
  if (isPrivate) return step('npm: private package, not published');
  const push = scoped(deps.exec(dir, PUBLISH_SECONDS), secrets);
  await publish(run, push, pkg, secrets['npm']?.['NPM_TOKEN']);
};

export const addRelease = (
  group: Command,
  release: (opts: ExtensionReleaseOptions) => Promise<void>
): void => {
  group
    .command('release')
    .description('Release an extension from its v* tag in CI: guard, images, record, npm package')
    .option('--dir <path>', 'the extension package folder (default: the current folder)')
    .option(
      '--timeout <seconds>',
      'bound on each git, GitHub and npm check (default: 60; npm publish: 300)',
      Number
    )
    .action(release);
};
