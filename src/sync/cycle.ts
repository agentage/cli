import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { conflictName } from './conflict.js';
import { createSyncGit, GitError, type GitErrorKind, type SyncGit } from './git-exec.js';
import { type SyncTarget } from './planner.js';

export interface SyncResult {
  vault: string;
  remote: string;
  ok: boolean;
  committed: boolean; // a sync commit was made for a dirty working tree
  pushed: boolean;
  conflicts: string[]; // paths written as `<name>.conflict.md`
  skipped?: 'lock' | 'busy';
  reason?: GitErrorKind;
  error?: string;
}

export interface CycleDeps {
  git?: SyncGit;
  now?: () => string;
}

const branchOf = async (git: SyncGit): Promise<string> => {
  const out = await git.exec(['symbolic-ref', '--short', 'HEAD']);
  return out.code === 0 && out.stdout.trim() ? out.stdout.trim() : 'main';
};

// Local, uncommitted, non-ignored changes -> one sync commit. Returns whether a commit was made.
const commitIfDirty = async (git: SyncGit, message: string): Promise<boolean> => {
  await git.run(['add', '-A']);
  const staged = await git.exec(['diff', '--cached', '--quiet']);
  if (staged.code === 0) return false;
  await git.run(['commit', '-m', message]);
  return true;
};

// The ignore rules ride on `.git/info/exclude` (local, uncommitted, gitignore syntax) rather than
// per-command pathspecs: it is the robust, idempotent mechanism - matching untracked files are
// never staged by `add -A`, and it leaves no committed `.gitignore` in the user's vault. An empty
// list clears it (sync everything).
const writeExclude = async (path: string, patterns: string[]): Promise<void> => {
  const infoDir = join(path, '.git', 'info');
  await mkdir(infoDir, { recursive: true });
  await writeFile(
    join(infoDir, 'exclude'),
    patterns.length ? patterns.join('\n') + '\n' : '',
    'utf8'
  );
};

const ensureRemote = async (git: SyncGit, name: string, url: string): Promise<void> => {
  const remotes = (await git.exec(['remote'])).stdout.split('\n').map((r) => r.trim());
  if (remotes.includes(name)) await git.run(['remote', 'set-url', name, url]);
  else await git.run(['remote', 'add', name, url]);
};

// Reconcile a diverged history keeping BOTH sides. A rebase probes for a true conflict; on a clean
// replay history stays linear. On conflict the local files are kept as-is and each conflicted
// file's remote copy is written alongside as `<name>.conflict.md`. The `.conflict.md` copies are
// staged into the SAME merge commit (`merge --no-commit`), so no single commit boundary ever
// leaves the remote side merged-away yet unsurfaced. Returns the conflict-copy paths written.
const reconcile = async (git: SyncGit, cwd: string, ref: string): Promise<string[]> => {
  const rebase = await git.exec(['rebase', ref]);
  if (rebase.code === 0) return [];

  const conflicted = (await git.exec(['diff', '--name-only', '--diff-filter=U'])).stdout
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  await git.exec(['rebase', '--abort']);

  const remoteSides = new Map<string, string>();
  for (const p of conflicted) {
    const show = await git.exec(['show', `${ref}:${p}`]);
    if (show.code === 0) remoteSides.set(p, show.stdout);
  }

  // Stage the merge WITHOUT committing (auto-resolving content conflicts to the local side); an
  // unresolvable conflict (add/add, modify/delete) falls back to keeping ours. Everything stays
  // staged so the conflict copies land in the very same commit.
  const merge = await git.exec(['merge', '--no-commit', '-X', 'ours', '--no-edit', ref]);
  if (merge.code !== 0) {
    await git.exec(['checkout', '--ours', '--', '.']);
    await git.run(['add', '-A']);
  }

  const written: string[] = [];
  for (const [p, content] of remoteSides) {
    const name = conflictName(p, (candidate) => existsSync(join(cwd, candidate)));
    const abs = join(cwd, name);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    written.push(name);
  }
  await git.run(['add', '-A']);
  await git.run(['commit', '--no-edit']);
  return written;
};

// One tolerant sync cycle for a single target: commit-if-dirty -> ensure remote -> fetch ->
// pull-rebase (keeping both sides on conflict) -> push. Every git failure is caught and classified
// so an unreachable remote or a held index.lock is a clean skip that the next cycle catches up.
export const runSyncCycle = async (
  target: SyncTarget,
  deps: CycleDeps = {}
): Promise<SyncResult> => {
  const git = deps.git ?? createSyncGit(target.path);
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const base: SyncResult = {
    vault: target.vault,
    remote: target.remote,
    ok: false,
    committed: false,
    pushed: false,
    conflicts: [],
  };
  let committed = false;
  let conflicts: string[] = [];
  try {
    if (!existsSync(target.path)) return { ...base, ok: true }; // nothing on disk yet
    if (!existsSync(join(target.path, '.git'))) await git.run(['init', '-b', 'main']);

    await writeExclude(target.path, target.ignore);
    await ensureRemote(git, target.remoteName, target.remote);
    committed = await commitIfDirty(git, `sync: ${now}`);
    const branch = await branchOf(git);
    const ref = `${target.remoteName}/${branch}`;

    const fetch = await git.exec(['fetch', target.remoteName]);
    if (fetch.code !== 0) throw new GitError(fetch);

    if ((await git.exec(['rev-parse', '--verify', ref])).code === 0) {
      conflicts = await reconcile(git, target.path, ref);
    }

    const push = await git.exec(['push', target.remoteName, `HEAD:${branch}`]);
    if (push.code !== 0) throw new GitError(push);

    return { ...base, ok: true, committed, pushed: true, conflicts };
  } catch (err) {
    if (err instanceof GitError) {
      // A concurrent engine mutation holding index.lock -> skip cleanly, retry next cycle.
      if (err.kind === 'lock')
        return { ...base, ok: true, committed, conflicts, skipped: 'lock', reason: 'lock' };
      return { ...base, ok: false, committed, conflicts, reason: err.kind, error: err.message };
    }
    return {
      ...base,
      ok: false,
      committed,
      conflicts,
      reason: 'other',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
