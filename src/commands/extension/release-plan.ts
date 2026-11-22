import { dateVersion, lastTag, newestTags, tagOf } from './release-date.js';
import { extensionFolders, type Folder } from './release-folders.js';
import { firstFive, sortChanged } from './release-ignore.js';
import { RECORD, type Exec } from './release-guard.js';
import { fail, step } from './release-steps.js';

export type Planned = Folder & { version: string; tag: string; why: string };

export type Refused = Folder & { err: unknown };

export type Plan = { changed: Planned[]; unchanged: Folder[]; refused: Refused[] };

export type PlanInput = { root: string; run: Exec; sha: string; repo: string; now: Date };

// A build that always fails stops here: no new tag after this many tags in a row with no record.
export const UNRECORDED_LIMIT = 3;

// Fail closed: a git call that cannot answer stops the release, never reads as "no change".
export const git = async (run: Exec, args: string[], what: string): Promise<string> => {
  const ran = await run('git', args);
  if (!ran.ok) fail(`${what}: git ${args[0] ?? ''}: ${ran.err}`);
  return ran.out;
};

// A default CI checkout has no tags and one commit: the ancestor check needs both.
export const fetchTags = async (run: Exec): Promise<void> => {
  const shallow = (await git(run, ['rev-parse', '--is-shallow-repository'], 'tags')).trim();
  const deepen = shallow === 'true' ? ['--unshallow'] : [];
  await git(run, ['fetch', '-q', '--tags', ...deepen, 'origin'], 'tags');
};

// Only "not found" means "no record"; any other answer stops the release.
const hasRecord = async (c: PlanInput, tag: string): Promise<boolean> => {
  const args = ['release', 'download', tag, '-R', c.repo, '-p', RECORD, '-O', '-'];
  const got = await c.run('gh', args);
  if (got.ok) return true;
  if (!/release not found|no assets match|no assets to download/.test(got.err))
    fail(`changed: cannot tell whether ${tag} has its record: ${got.err}`);
  return false;
};

// The newest tags with no record, up to the first that has one.
const unrecorded = async (c: PlanInput, f: Folder, tags: string[]): Promise<string[]> => {
  const missing: string[] = [];
  for (const tag of newestTags(f.id, tags).slice(0, UNRECORDED_LIMIT)) {
    if (await hasRecord(c, tag)) break;
    missing.push(tag);
  }
  if (missing.length === UNRECORDED_LIMIT)
    fail(`stuck: ${missing.join(', ')} have no record: fix the release, or remove those tags`);
  return missing;
};

type Why = { why?: string; ignored: string[] };

// From the last tag, not the push range: a run the concurrency group dropped is caught up here.
const whyOf = async (c: PlanInput, f: Folder, tags: string[], last?: string): Promise<Why> => {
  if (!last) return { why: `has no ${f.id}@* tag yet`, ignored: [] };
  const missing = await unrecorded(c, f, tags);
  // No renames: a move from src/ to docs/ names the src/ path; -z keeps odd names exact.
  const args = ['diff', '--name-only', '-z', '--no-renames', last, c.sha, '--', f.rel];
  const { counted, ignored } = await sortChanged(c.root, f.rel, await git(c.run, args, 'changed'));
  if (counted.length > 0) return { why: `differs from ${last} in ${firstFive(counted)}`, ignored };
  // A release that failed after its tag: the next commit releases it with a new N.
  if (missing[0] === last) return { why: `equals ${last}, which has no record`, ignored };
  return { ignored };
};

const sameAs = (f: Folder, last: string | undefined, ignored: string[]): void => {
  const only = ignored.length > 0 ? `; only ignored files changed: ${firstFive(ignored)}` : '';
  step(`unchanged: ${f.id} (${f.rel}) is the same as ${String(last)}${only}`);
};

// A re-run of an old commit must not give older code a higher version than its last tag.
const inHistory = async (c: PlanInput, last: string, at: string): Promise<void> => {
  const ahead = await git(c.run, ['rev-list', '--count', `${c.sha}..${at}`], 'history');
  if (ahead.trim() !== '0')
    fail(`history: ${last} is on ${at}, which is not before ${c.sha}: an older commit is refused`);
};

const planned = (f: Folder, version: string, why: string): Planned => {
  const tag = tagOf(f.id, version);
  step(`changed: ${f.id} (${f.rel}) ${why}: release ${tag}`);
  return { ...f, version, tag, why };
};

const planOne = async (c: PlanInput, f: Folder): Promise<Planned | undefined> => {
  const tags = (await git(c.run, ['tag', '-l', `${f.id}@*`], 'tags')).split('\n').filter(Boolean);
  const last = lastTag(f.id, tags);
  // A re-run of the commit its last tag is on: resume that version (the guard reuses or builds).
  const at = last ? (await git(c.run, ['rev-list', '-n', '1', last], 'tags')).trim() : '';
  if (last && at === c.sha)
    return planned(f, last.slice(f.id.length + 1), `${last} is on this commit: resume it`);
  if (last) await inHistory(c, last, at);
  const { why, ignored } = await whyOf(c, f, tags, last);
  if (why) return planned(f, dateVersion(f.id, tags, c.now), why);
  sameAs(f, last, ignored);
  return undefined;
};

// One refused extension never stops the plan of the others.
const sort = async (c: PlanInput, f: Folder, plan: Plan): Promise<void> => {
  try {
    const p = await planOne(c, f);
    if (p) plan.changed.push(p);
    else plan.unchanged.push(f);
  } catch (e) {
    plan.refused.push({ ...f, err: e });
  }
};

export const planRelease = async (c: PlanInput): Promise<Plan> => {
  const folders = await extensionFolders(c.root);
  if (folders.length === 0) fail('folders: no extension package at the root or in extensions/*');
  const plan: Plan = { changed: [], unchanged: [], refused: [] };
  for (const f of folders) await sort(c, f, plan);
  return plan;
};
