import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionPackage } from '@agentage/extension/tool';
import { CliError } from '../../lib/json-output.js';
import { runImageBuild, type Committed } from './build.js';
import { type LoadKitTool } from './kit-tool.js';
import { CONTAINER_RECORD, imagesOf, PART_SUFFIX, RECORD, type Exec } from './release-guard.js';

export const step = (line: string): void => console.log(`PASS ${line}`);

export const fail = (line: string): never => {
  throw new CliError('release_refused', `FAIL ${line}`);
};

// Tokens leave the environment, so docker build and npm lifecycle scripts never see them.
export const takeSecrets = (env: NodeJS.ProcessEnv): Record<string, NodeJS.ProcessEnv> => {
  const { GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN } = env;
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN']) delete env[name];
  const gh = GH_TOKEN ?? GITHUB_TOKEN;
  return { gh: gh ? { GH_TOKEN: gh } : {}, npm: NPM_TOKEN ? { NPM_TOKEN } : {} };
};

export const scoped =
  (exec: Exec, secrets: Record<string, NodeJS.ProcessEnv>): Exec =>
  (cmd, args) =>
    exec(cmd, args, secrets[cmd]);

// Every image is pushed first. The records go up one call each, RECORD last: it is the "done" marker.
export const attach = async (
  run: Exec,
  tag: string,
  repo: string,
  names: string[],
  target?: string
): Promise<void> => {
  const notes = ['--title', tag, '--notes', `Images by digest: ${names.join(', ')}`];
  if (target) notes.push('--target', target);
  let exists = (await run('gh', ['release', 'view', tag, '-R', repo])).ok;
  for (const name of names) {
    const file = join('dist', name);
    const args = exists ? ['upload', tag, file] : ['create', tag, file, ...notes];
    const ran = await run('gh', ['release', ...args, '-R', repo]);
    if (!ran.ok) fail(`record: ${ran.err}`);
    exists = true;
  }
  step(`record: ${names.join(', ')} attached to release ${tag}`);
};

// The part images (v13 rows, the estate) and the one image (app hosts), all pushed by digest.
export const buildImages = async (
  dir: string,
  oneImage: boolean,
  tool: LoadKitTool,
  committed?: Committed
) => {
  await runImageBuild({ push: true, dir }, tool, committed);
  if (!oneImage) return [RECORD];
  // The second compile may clean dist/: the part record is kept and written back.
  const record = await readFile(join(dir, 'dist', RECORD));
  // The first build checked this HEAD; its own dist/ output must not read as a change.
  await runImageBuild({ push: true, container: true, dir }, tool, async () => undefined);
  await writeFile(join(dir, 'dist', RECORD), record);
  return [CONTAINER_RECORD, RECORD];
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
export const PUBLISH_SECONDS = 300;

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
export const publish = async (
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

export const npmVersion = async (run: Exec): Promise<void> => {
  const v = (await run('npm', ['--version'])).out.trim();
  const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
  if (major * 1e6 + minor * 1e3 + patch < 11_005_001)
    fail(`npm: npm ${v} cannot publish with OIDC: needs npm >= 11.5.1`);
  step(`npm: npm ${v}`);
};

export const idChecks = (pkg: ExtensionPackage): void => {
  if (pkg.agentage.id === 'template')
    fail('id: this repo is the starting point for extensions: create one, release that');
  step(`id: ${pkg.agentage.id} is not the template`);
  if (imagesOf(pkg).oneImage && PART_SUFFIX.test(pkg.agentage.id))
    fail(`id: ${pkg.agentage.id} ends in a part name: it would name another extension's image`);
};

export const onMaster = async (run: Exec, sha: string): Promise<void> => {
  const fetched = await run('git', ['fetch', '-q', 'origin', 'master']);
  if (!fetched.ok || !(await run('git', ['merge-base', '--is-ancestor', sha, 'origin/master'])).ok)
    fail(`master: ${sha} is not on master${fetched.err ? `: ${fetched.err}` : ''}`);
  step(`master: ${sha} is on master`);
};
