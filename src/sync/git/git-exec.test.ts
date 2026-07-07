import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyGitError, createSyncGit, GitError } from './git-exec.js';

describe('classifyGitError', () => {
  it('detects a held index.lock as a lock error', () => {
    expect(classifyGitError("fatal: Unable to create '/v/.git/index.lock': File exists.")).toBe(
      'lock'
    );
    expect(classifyGitError('Another git process seems to be running')).toBe('lock');
  });

  it('detects an unreachable remote', () => {
    expect(classifyGitError("fatal: '/nope/x.git' does not appear to be a git repository")).toBe(
      'unreachable'
    );
    expect(classifyGitError('ssh: Could not resolve hostname github.com')).toBe('unreachable');
    expect(classifyGitError('Connection refused')).toBe('unreachable');
  });

  it('detects a merge/rebase conflict', () => {
    expect(classifyGitError('CONFLICT (content): Merge conflict in a.md')).toBe('conflict');
    expect(classifyGitError('error: could not apply 1a2b3c...')).toBe('conflict');
  });

  it('falls back to other for anything else', () => {
    expect(classifyGitError('some unrelated failure')).toBe('other');
  });
});

describe('createSyncGit', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-git-exec-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('run returns stdout on success and throws a classified GitError on failure', async () => {
    const git = createSyncGit(dir);
    await git.run(['init', '-b', 'main']);
    const branch = (await git.run(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(branch).toBe('main');

    await expect(git.run(['rev-parse', '--verify', 'sync/main'])).rejects.toBeInstanceOf(GitError);
  });

  it('exec never throws and reports a non-zero code', async () => {
    const git = createSyncGit(dir);
    const res = await git.exec(['fetch', 'sync']);
    expect(res.code).not.toBe(0);
    expect(res.stderr.length).toBeGreaterThan(0);
  });
});
