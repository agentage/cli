import { join } from 'node:path';
import type { ExtensionPackage } from '@agentage/extension/tool';
import { CliError } from '../../lib/json-output.js';
import type { ExtensionReleaseOptions, ReleaseDeps } from './release.js';
import { writeCiCopy } from './release-folders.js';
import { imagesOf, releaseGuard, type Exec } from './release-guard.js';
import { amber, npmRefusal } from './release-npm.js';
import { fetchTags, git, planRelease, type Plan, type Planned } from './release-plan.js';
import { rowsOf, summary, type Row } from './release-summary.js';
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

type Session = {
  root: string;
  run: Exec;
  deps: ReleaseDeps;
  secrets: Record<string, NodeJS.ProcessEnv>;
  sha: string;
  repo: string;
  timeout: number;
  written: string[];
};

const inputs = async (run: Exec, env: NodeJS.ProcessEnv) => {
  const repo = env['GITHUB_REPOSITORY'];
  if (!repo) return fail('inputs: GITHUB_REPOSITORY is not set; run it in CI on a push to master');
  const sha = env['GITHUB_SHA'] || (await git(run, ['rev-parse', 'HEAD'], 'inputs')).trim();
  return { repo, sha };
};

// The build needs a committed tree: only the CI copy files this run wrote may differ.
const committedBut = (s: Session) => async (): Promise<void> => {
  const args = ['status', '--porcelain', '--', '.', ...s.written.map((f) => `:(exclude)${f}`)];
  const dirty = (await git(s.run, args, 'build')).trim();
  if (dirty)
    throw new CliError('uncommitted_changes', `uncommitted changes: ${dirty}: commit first`);
};

// Tag first: a failed build still uses up its N, so the next run takes a new version.
const createTag = async (s: Session, tag: string): Promise<void> => {
  const ref = ['-f', `ref=refs/tags/${tag}`, '-f', `sha=${s.sha}`];
  const made = await s.run('gh', ['api', `repos/${s.repo}/git/refs`, ...ref]);
  if (made.ok) return step(`tag: ${tag} created on ${s.sha}`);
  if (!/Reference already exists/.test(made.err)) fail(`tag: ${made.err}`);
  const at = await s.run('gh', [
    'api',
    `repos/${s.repo}/git/ref/tags/${tag}`,
    '--jq',
    '.object.sha',
  ]);
  const on = at.out.trim();
  if (on !== s.sha) fail(`tag: ${tag} is on ${on || at.err}, not ${s.sha}: a moved tag is refused`);
  step(`tag: ${tag} is on ${s.sha}`);
};

// The date version in package.json, the lock and the committed contracts that carry it.
const prepare = async (s: Session, p: Planned): Promise<ExtensionPackage> => {
  const dir = join(s.root, p.rel);
  s.written.push(...(await writeCiCopy(s.root, p, p.version, s.repo)));
  const tool = await s.deps.tool();
  const pkg = await tool.readManifest(dir);
  idChecks(pkg);
  const { parts } = imagesOf(pkg);
  if (parts.includes('api') || parts.includes('mcp')) {
    const files = await tool
      .writeContracts(dir)
      .catch((e: Error) => fail(`contracts: ${e.message}`));
    s.written.push(...files.map((f) => join(p.rel, f)));
  }
  step(`version: ${p.id} is ${p.version} in this CI copy only`);
  return pkg;
};

type Npm = { dir: string; pkg: ExtensionPackage; refusal?: string };

const npmStep = async (s: Session, run: Exec, { dir, pkg, refusal }: Npm) => {
  if (pkg['private'] === true) return step('npm: private package, not published');
  if (refusal) return amber(`npm: ${refusal}`);
  const push = scoped(s.deps.exec(dir, PUBLISH_SECONDS), s.secrets);
  await publish(run, push, pkg, s.secrets['npm']?.['NPM_TOKEN']);
};

// A released version is never rebuilt: the guard reuses its record, else it builds the images.
const imagesStep = async (s: Session, p: Planned, run: Exec, pkg: ExtensionPackage) => {
  const { parts, oneImage } = imagesOf(pkg);
  const dir = join(s.root, p.rel);
  const g = { dir, tag: p.tag, sha: s.sha, repo: s.repo, id: p.id, version: p.version };
  const decision = await releaseGuard({ ...g, parts, oneImage }, run).catch((e: Error) =>
    fail(`guard: ${e.message}`)
  );
  const built = decision === 'build';
  step(`guard: ${p.tag} ${built ? 'has no record and no image: build' : 'is released: npm only'}`);
  return built ? buildImages(dir, oneImage, s.deps.tool, committedBut(s)) : [];
};

// The record is the "released" marker: it goes up only after npm has the version.
const releaseOne = async (s: Session, p: Planned, row: Row) => {
  const pkg = await prepare(s, p);
  const dir = join(s.root, p.rel);
  const run = scoped(s.deps.exec(dir, s.timeout), s.secrets);
  const isPrivate = pkg['private'] === true;
  const refusal = isPrivate ? undefined : await npmRefusal(run, s.repo, pkg);
  if (refusal) row.result = 'released, AMBER: npm skipped';
  if (!isPrivate && !refusal) await npmVersion(run);
  await createTag(s, p.tag);
  const records = await imagesStep(s, p, run, pkg);
  await npmStep(s, run, { dir, pkg, refusal });
  if (records.length > 0) await attach(run, p.tag, s.repo, records, s.sha);
  return {
    id: p.id,
    version: p.version,
    tag: p.tag,
    built: records.length > 0,
    published: !isPrivate && !refusal,
  };
};

// Every changed extension is tried; its folder then no longer counts as a change for the next build.
const releaseAll = async (s: Session, plan: Plan) => {
  const released: Awaited<ReturnType<typeof releaseOne>>[] = [];
  const rows = rowsOf(plan.refused, 'refused');
  for (const p of plan.changed) {
    const row: Row = { id: p.id, version: p.version, result: 'released' };
    await releaseOne(s, p, row).then(
      (r) => void released.push(r),
      (err: unknown) => Object.assign(row, { result: 'failed', err })
    );
    s.written.push(p.rel);
    rows.push(row);
  }
  rows.push(...rowsOf(plan.unchanged, 'unchanged'));
  summary(rows);
  return released;
};

const dryRun = (plan: Plan) => {
  const tags = plan.changed.map((p) => p.tag).join(', ') || 'nothing';
  step(`dry run: would release ${tags}; nothing was written, tagged, pushed or published`);
  summary(rowsOf(plan.refused, 'refused'));
  return { dryRun: true, changed: plan.changed, unchanged: plan.unchanged.map((f) => f.id) };
};

// Each extension changed since its last <id>@* tag gets a date version, its tag, images and npm.
export const runChangedRelease = async (
  { dir = '.', timeout = 60, dryRun: dry }: ExtensionReleaseOptions,
  deps: ReleaseDeps
): Promise<unknown> => {
  const secrets = takeSecrets(deps.env);
  const run = scoped(deps.exec(dir, timeout), secrets);
  const { repo, sha } = await inputs(run, deps.env);
  await onMaster(run, sha);
  await fetchTags(run);
  const now = deps.now?.() ?? new Date();
  const plan = await planRelease({ root: dir, run, sha, repo, now });
  if (dry) return dryRun(plan);
  const s: Session = { root: dir, run, deps, secrets, sha, repo, timeout, written: [] };
  return { released: await releaseAll(s, plan), unchanged: plan.unchanged.map((f) => f.id) };
};
