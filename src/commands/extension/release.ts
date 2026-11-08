import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Command } from 'commander';
import type { ExtensionPackage } from '@agentage/extension/tool';
import { assertCommitted, runExtensionBuild, type Committed } from './build.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { execIn, IMAGE_PARTS, RECORD, releaseGuard, type Exec } from './release-guard.js';

export type ExtensionReleaseOptions = { dir?: string; timeout?: number };

export interface ReleaseDeps {
  exec: (cwd: string, seconds?: number) => Exec;
  tool: LoadKitTool;
  committed: Committed;
  env: NodeJS.ProcessEnv;
}

const defaultDeps: ReleaseDeps = {
  exec: execIn,
  tool: loadKitTool,
  committed: assertCommitted,
  env: process.env,
};

const step = (name: string, fail: string | false, pass: string): void => {
  if (fail) throw new Error(`FAIL ${name}: ${fail}`);
  console.log(`PASS ${name}: ${pass}`);
};

const need = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value)
    throw new Error(`FAIL inputs: ${name} is not set; release runs in a GitHub Actions tag push`);
  return value;
};

const imageParts = (pkg: ExtensionPackage) =>
  IMAGE_PARTS.filter((part) => (pkg.agentage.parts[part] ?? false) !== false);

// The record by digest on the tag's release; the release is created when the tag has none.
const attach = async (run: Exec, tag: string, repo: string): Promise<void> => {
  const file = join('dist', RECORD);
  const exists = (await run('gh', ['release', 'view', tag, '-R', repo])).ok;
  const notes = ['--title', tag, '--notes', `Images by digest: ${RECORD}`];
  const args = exists ? ['upload', tag, file] : ['create', tag, file, ...notes];
  const ran = await run('gh', ['release', ...args, '-R', repo]);
  step('record', !ran.ok && ran.err, `${RECORD} attached to release ${tag}`);
};

// Single quotes on purpose: npm expands ${NPM_TOKEN} itself, the token never lands on disk.
const tokenConfig = async (token?: string): Promise<string[]> => {
  if (!token) return [];
  const file = join(await mkdtemp(join(tmpdir(), 'agentage-npm-')), '.npmrc');
  await writeFile(file, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n');
  return ['--userconfig', file];
};

const stage = async (run: Exec, flags: string[], spec: string, why: string): Promise<void> => {
  const ran = await run('npm', ['stage', 'publish', ...flags]);
  step('npm', !ran.ok && ran.err, `${spec} staged for approval (${why})`);
};

// OIDC trusted publishing; a new name (NPM_TOKEN set) or an unauthorized direct publish is staged.
const publish = async (run: Exec, { name, version }: ExtensionPackage, token?: string) => {
  const cfg = await tokenConfig(token);
  const spec = `${name}@${version}`;
  const seen = await run('npm', ['view', spec, 'version', ...cfg]);
  if (seen.ok && seen.out.trim()) return step('npm', false, `${spec} is already on npm`);
  const flags = ['--access', 'public', '--provenance', ...cfg];
  if (token && !(await run('npm', ['view', name, 'name', ...cfg])).ok)
    return stage(run, flags, spec, 'a new name has no trusted publisher');
  if ((await run('npm', ['publish', ...flags])).ok) return step('npm', false, `${spec} published`);
  await stage(run, flags, spec, 'direct publish not authorized: no validated trusted publisher');
};

const npmVersion = async (run: Exec): Promise<void> => {
  const v = (await run('npm', ['--version'])).out.trim();
  const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
  const fits = major * 1e6 + minor * 1e3 + patch >= 11_005_001;
  step('npm', !fits && `npm ${v} cannot publish with OIDC: needs npm >= 11.5.1`, `npm ${v}`);
};

const preflight = async (run: Exec, pkg: ExtensionPackage, tag: string, sha: string) => {
  const { id } = pkg.agentage;
  const starter = 'this repo is the starting point for extensions: create one, release that';
  step('id', id === 'template' && starter, `${id} is not the template`);
  const fetched = (await run('git', ['fetch', '-q', 'origin', 'master'])).ok;
  const onMaster =
    fetched && (await run('git', ['merge-base', '--is-ancestor', sha, 'origin/master'])).ok;
  step('master', !onMaster && `${sha} is not on master`, `${sha} is on master`);
  const v = `v${pkg.version}`;
  const moved = `${tag} is not ${v}, the package.json version; tag the commit that sets it`;
  step('tag', tag !== v && moved, `${tag} is the package.json version`);
  await npmVersion(run);
};

interface Inputs {
  tag: string;
  sha: string;
  repo: string;
}

const inputs = (env: NodeJS.ProcessEnv): Inputs => ({
  tag: need(env, 'GITHUB_REF_NAME'),
  sha: need(env, 'GITHUB_SHA'),
  repo: need(env, 'GITHUB_REPOSITORY'),
});

const guard = (exec: Exec, pkg: ExtensionPackage, dir: string, at: Inputs) => {
  const input = { ...at, dir, id: pkg.agentage.id, version: pkg.version, parts: imageParts(pkg) };
  return releaseGuard(input, exec).catch((e: Error) => {
    throw new Error(`FAIL guard: ${e.message}`);
  });
};

// One line per step, PASS or FAIL; any refusal exits 1 before anything is pushed or published.
export const runExtensionRelease = async (
  { dir = '.', timeout = 60 }: ExtensionReleaseOptions = {},
  deps: ReleaseDeps = defaultDeps
): Promise<void> => {
  const at = inputs(deps.env);
  const pkg = await (await deps.tool()).readManifest(dir);
  const run = deps.exec(dir);
  await preflight(run, pkg, at.tag, at.sha);
  const build = (await guard(deps.exec(dir, timeout), pkg, dir, at)) === 'build';
  step(
    'guard',
    false,
    build ? `${at.tag} has no record and no image: build` : `${at.tag} is released: npm only`
  );
  if (build) {
    await runExtensionBuild({ push: true, dir }, deps.tool, deps.committed);
    await attach(run, at.tag, at.repo);
  }
  await publish(run, pkg, deps.env['NPM_TOKEN']);
};

const RELEASE_HELP = `
Releases the extension package in --dir from a v* tag push in GitHub Actions (GITHUB_REF_NAME,
GITHUB_SHA, GITHUB_REPOSITORY, GH_TOKEN; NPM_TOKEN stages the first publish of a new name).
Refuses the template, a commit not on master and a tag that is not v<version>. A released version
is kept: a re-run of its commit retries npm only; a moved tag, or an image pushed without a record,
is refused, as is a GitHub or registry call that fails or outlasts --timeout. Then build --push,
${RECORD} on the tag's GitHub release, npm publish --provenance (staged when not authorized).
Needs docker login and npm >= 11.5.1. Exits 1 on any refusal.`;

export const addRelease = (
  group: Command,
  release: (opts: ExtensionReleaseOptions) => Promise<void>
): void => {
  group
    .command('release')
    .description('Release an extension from its tag: images, record, npm package')
    .option('--dir <path>', 'the extension package folder (default: the current folder)')
    .option('--timeout <seconds>', 'bound on each GitHub and registry check (default: 60)', Number)
    .addHelpText('after', RELEASE_HELP)
    .action(release);
};
