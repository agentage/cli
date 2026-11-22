import { dateVersion, lastTag, tagOf } from './release-date.js';
import { extensionFolders, type Folder } from './release-folders.js';
import { RECORD, type Exec } from './release-guard.js';
import { fail, step } from './release-steps.js';

export type Planned = Folder & { version: string; tag: string; why: string };

export type Plan = { changed: Planned[]; unchanged: Folder[] };

export type PlanInput = { root: string; run: Exec; sha: string; repo: string; now: Date };

// Fail closed: a git call that cannot answer stops the release, never reads as "no change".
export const git = async (run: Exec, args: string[], what: string): Promise<string> => {
  const ran = await run('git', args);
  if (!ran.ok) fail(`${what}: git ${args[0] ?? ''}: ${ran.err}`);
  return ran.out;
};

// A default CI checkout has no tags: without them every extension would read as never released.
export const fetchTags = async (run: Exec): Promise<void> => {
  await git(run, ['fetch', '-q', '--tags', 'origin'], 'tags');
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

// From the last tag, not the push range: a run the concurrency group dropped is caught up here.
const whyOf = async (c: PlanInput, f: Folder, last?: string): Promise<string | undefined> => {
  if (!last) return `has no ${f.id}@* tag yet`;
  const diff = await git(c.run, ['diff', '--name-only', last, c.sha, '--', f.rel], 'changed');
  if (diff.trim()) return `differs from ${last}`;
  // A release that failed after its tag: the next commit releases it with a new N.
  if (!(await hasRecord(c, last))) return `equals ${last}, which has no record`;
  return undefined;
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
  const at = last ? await git(c.run, ['rev-list', '-n', '1', last], 'tags') : '';
  if (last && at.trim() === c.sha)
    return planned(f, last.slice(f.id.length + 1), `${last} is on this commit: resume it`);
  const why = await whyOf(c, f, last);
  if (why) return planned(f, dateVersion(f.id, tags, c.now), why);
  step(`unchanged: ${f.id} (${f.rel}) is the same as ${String(last)}`);
  return undefined;
};

export const planRelease = async (c: PlanInput): Promise<Plan> => {
  const folders = await extensionFolders(c.root);
  if (folders.length === 0) fail('folders: no extension package at the root or in extensions/*');
  const plan: Plan = { changed: [], unchanged: [] };
  for (const f of folders) {
    const p = await planOne(c, f);
    if (p) plan.changed.push(p);
    else plan.unchanged.push(f);
  }
  return plan;
};
