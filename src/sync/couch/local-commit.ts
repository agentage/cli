import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncGit, GitError } from '../git/git-exec.js';
import { type CommitOutcome } from './manager.types.js';

// The default local-git commit: stage everything and make one commit when the tree is dirty. An
// index.lock collision (the engine mid-mutation) is a clean skip - the change stays for next cycle.
export const gitCommitDirty = async (path: string, message: string): Promise<CommitOutcome> => {
  if (!existsSync(path)) return { committed: false, skipped: false };
  const git = createSyncGit(path);
  try {
    if (!existsSync(join(path, '.git'))) await git.run(['init', '-b', 'main']);
    await git.run(['add', '-A']);
    if ((await git.exec(['diff', '--cached', '--quiet'])).code === 0)
      return { committed: false, skipped: false };
    await git.run(['commit', '-m', message]);
    return { committed: true, skipped: false };
  } catch (err) {
    if (err instanceof GitError && err.kind === 'lock') return { committed: false, skipped: true };
    throw err;
  }
};
