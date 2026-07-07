import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSyncCycle } from './cycle.js';
import { type SyncTarget } from './planner.js';

// Real git in temp dirs: a bare remote + a working copy, exercising commit/push, no-op, ignore,
// conflict materialization, and unreachable handling end to end (the unit-tier proof of the sync
// engine's git behavior; the pure planner/conflict logic is covered separately).

const IDENTITY = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

const g = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } });

const writeFile = (root: string, rel: string, body: string): void => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
};

const target = (over: Partial<SyncTarget> & Pick<SyncTarget, 'path' | 'remote'>): SyncTarget => ({
  vault: 'v',
  remoteName: 'sync',
  intervalSeconds: 0,
  ignore: ['.obsidian/', 'data.json'],
  ...over,
});

describe('runSyncCycle', () => {
  let root: string;
  let bare: string;
  let work: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sync-cycle-'));
    bare = join(root, 'remote.git');
    work = join(root, 'work');
    g(root, ['init', '--bare', '-b', 'main', bare]);
    mkdirSync(work);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('commits a dirty working tree and pushes it to an empty bare remote', async () => {
    writeFile(work, 'notes/a.md', 'hello quokka');
    const result = await runSyncCycle(target({ path: work, remote: bare }));
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(g(bare, ['show', 'main:notes/a.md'])).toContain('hello quokka');
  });

  it('skips an unsafe transport-helper remote without touching git', async () => {
    writeFile(work, 'a.md', 'x');
    const result = await runSyncCycle(target({ path: work, remote: 'ext::sh -c "id"' }));
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe('invalid-remote');
    expect(result.pushed).toBe(false);
    expect(existsSync(join(work, '.git'))).toBe(false);
  });

  it('is a no-op on the second cycle (nothing to commit)', async () => {
    writeFile(work, 'a.md', 'x');
    await runSyncCycle(target({ path: work, remote: bare }));
    const second = await runSyncCycle(target({ path: work, remote: bare }));
    expect(second.ok).toBe(true);
    expect(second.committed).toBe(false);
    expect(second.pushed).toBe(true);
  });

  it('honors the ignore list (defaults exclude .obsidian/ and data.json)', async () => {
    writeFile(work, 'note.md', 'keep me');
    writeFile(work, '.obsidian/app.json', '{}');
    writeFile(work, 'data.json', '{}');
    const result = await runSyncCycle(target({ path: work, remote: bare }));
    expect(result.ok).toBe(true);
    const tracked = g(work, ['ls-files']).trim().split('\n');
    expect(tracked).toContain('note.md');
    expect(tracked).not.toContain('.obsidian/app.json');
    expect(tracked).not.toContain('data.json');
  });

  it('an empty ignore list syncs everything', async () => {
    writeFile(work, 'note.md', 'keep me');
    writeFile(work, '.obsidian/app.json', '{}');
    const result = await runSyncCycle(target({ path: work, remote: bare, ignore: [] }));
    expect(result.ok).toBe(true);
    const tracked = g(work, ['ls-files']).trim().split('\n');
    expect(tracked).toContain('note.md');
    expect(tracked).toContain('.obsidian/app.json');
  });

  it('keeps both sides on divergence: local file stays, remote copy -> .conflict.md, zero loss', async () => {
    // Shared base pushed to the bare remote.
    writeFile(work, 'note.md', 'base\n');
    await runSyncCycle(target({ path: work, remote: bare }));

    // A second clone advances the remote with a conflicting change.
    const other = join(root, 'other');
    g(root, ['clone', bare, other]);
    writeFile(other, 'note.md', 'REMOTE-CHANGE\n');
    g(other, ['commit', '-am', 'remote change']);
    g(other, ['push', 'origin', 'HEAD:main']);

    // Local makes its own conflicting change (as the engine would: a committed mutation).
    writeFile(work, 'note.md', 'LOCAL-CHANGE\n');
    g(work, ['commit', '-am', 'local change']);

    const result = await runSyncCycle(target({ path: work, remote: bare }));
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.conflicts).toEqual(['note.conflict.md']);

    // Local: original file keeps the local side; the conflict file holds the remote side.
    expect(readFileSync(join(work, 'note.md'), 'utf8')).toContain('LOCAL-CHANGE');
    expect(readFileSync(join(work, 'note.conflict.md'), 'utf8')).toContain('REMOTE-CHANGE');

    // Remote: the push landed, both sides preserved there too.
    expect(g(bare, ['show', 'main:note.md'])).toContain('LOCAL-CHANGE');
    expect(g(bare, ['show', 'main:note.conflict.md'])).toContain('REMOTE-CHANGE');

    // Crash-window closed: the conflict copy is committed in the SAME (merge) commit, never a
    // follow-up. HEAD is a merge (two parents) and its own diff lists the conflict file.
    expect(g(work, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')).toHaveLength(3);
    const mergeFiles = g(work, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n');
    expect(mergeFiles).toContain('note.conflict.md');
  });

  it('auto-commit message is an ISO-stamped `sync:` line', async () => {
    writeFile(work, 'a.md', 'x');
    await runSyncCycle(target({ path: work, remote: bare }));
    expect(g(work, ['log', '-1', '--format=%s']).trim()).toMatch(/^sync: \d{4}-/);
  });

  it('keeps syncing a file that is tracked before being added to ignore', async () => {
    writeFile(work, 'tracked.md', 'v1\n');
    await runSyncCycle(target({ path: work, remote: bare }));
    // gitignore semantics only affect untracked paths: a tracked file's edits still commit + push.
    writeFile(work, 'tracked.md', 'v2\n');
    const result = await runSyncCycle(target({ path: work, remote: bare, ignore: ['tracked.md'] }));
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(g(bare, ['show', 'main:tracked.md'])).toContain('v2');
  });

  // Set up a diverged pair: remote holds REMOTE-CHANGE on note.md + extra.md, local holds
  // LOCAL-CHANGE on note.md; both committed. Used by the crash-recovery tests below.
  const diverge = async (): Promise<void> => {
    writeFile(work, 'note.md', 'base\n');
    await runSyncCycle(target({ path: work, remote: bare }));
    const other = join(root, 'other');
    g(root, ['clone', bare, other]);
    writeFile(other, 'note.md', 'REMOTE-CHANGE\n');
    writeFile(other, 'extra.md', 'remote extra\n');
    g(other, ['add', '-A']);
    g(other, ['commit', '-m', 'remote change']);
    g(other, ['push', 'origin', 'HEAD:main']);
    writeFile(work, 'note.md', 'LOCAL-CHANGE\n');
    g(work, ['commit', '-am', 'local change']);
  };

  it('recovers when a previous cycle died between `merge --no-commit` and its commit', async () => {
    await diverge();
    // Simulate the crash: the merge is staged (MERGE_HEAD present) but never committed.
    g(work, ['fetch', 'sync']);
    g(work, ['merge', '--no-commit', '-X', 'ours', 'sync/main']);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);

    const result = await runSyncCycle(target({ path: work, remote: bare }));
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.conflicts).toEqual(['note.conflict.md']);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    // No bogus half-merge minted as a `sync:` auto-commit: HEAD is a proper merge commit
    // carrying the conflict copy, and both sides survived to the remote.
    expect(g(work, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')).toHaveLength(3);
    expect(g(bare, ['show', 'main:note.md'])).toContain('LOCAL-CHANGE');
    expect(g(bare, ['show', 'main:note.conflict.md'])).toContain('REMOTE-CHANGE');
    expect(g(bare, ['show', 'main:extra.md'])).toContain('remote extra');

    // Pushes resume: the next cycle is a clean no-op, not a wedge.
    const next = await runSyncCycle(target({ path: work, remote: bare }));
    expect(next.ok).toBe(true);
    expect(next.committed).toBe(false);
    expect(next.pushed).toBe(true);
  });

  it('recovers when a user edited a merge-touched file after a mid-merge crash', async () => {
    await diverge();
    // Crash state + a user edit to a file the staged merge touched: `merge --abort` refuses
    // ("entry not uptodate"), so recovery must complete the merge instead of leaking MERGE_HEAD.
    g(work, ['fetch', 'sync']);
    g(work, ['merge', '--no-commit', '-X', 'ours', 'sync/main']);
    writeFile(work, 'note.md', 'USER-EDIT\n');

    const results = [];
    for (let i = 0; i < 3; i++)
      results.push(await runSyncCycle(target({ path: work, remote: bare })));
    // No permanent ok:false loop.
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.pushed)).toEqual([true, true, true]);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);

    // No phantom conflict-file accumulation across cycles.
    const conflictFiles = g(work, ['ls-files'])
      .split('\n')
      .filter((f) => f.includes('.conflict'));
    expect(conflictFiles.length).toBeLessThanOrEqual(1);

    // The user edit survived and reached the remote; the remote side stays reachable in history.
    expect(readFileSync(join(work, 'note.md'), 'utf8')).toContain('USER-EDIT');
    expect(g(bare, ['show', 'main:note.md'])).toContain('USER-EDIT');
    expect(g(bare, ['show', 'main:extra.md'])).toContain('remote extra');
  });

  it('recovers when a previous cycle died mid-rebase', async () => {
    await diverge();
    g(work, ['fetch', 'sync']);
    try {
      g(work, ['rebase', 'sync/main']); // conflicts -> leaves .git/rebase-merge behind
    } catch {
      // expected: conflicted rebase exits non-zero
    }
    expect(existsSync(join(work, '.git', 'rebase-merge'))).toBe(true);

    const result = await runSyncCycle(target({ path: work, remote: bare }));
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.conflicts).toEqual(['note.conflict.md']);
    expect(existsSync(join(work, '.git', 'rebase-merge'))).toBe(false);
    expect(g(bare, ['show', 'main:note.md'])).toContain('LOCAL-CHANGE');
    expect(g(bare, ['show', 'main:note.conflict.md'])).toContain('REMOTE-CHANGE');
  });

  it('merges remote non-conflicting changes cleanly', async () => {
    writeFile(work, 'a.md', 'a\n');
    await runSyncCycle(target({ path: work, remote: bare }));

    const other = join(root, 'other');
    g(root, ['clone', bare, other]);
    writeFile(other, 'b.md', 'from remote\n');
    g(other, ['add', '-A']);
    g(other, ['commit', '-m', 'add b']);
    g(other, ['push', 'origin', 'HEAD:main']);

    writeFile(work, 'a.md', 'a changed\n');
    g(work, ['commit', '-am', 'change a']);

    const result = await runSyncCycle(target({ path: work, remote: bare }));
    expect(result.ok).toBe(true);
    expect(result.conflicts).toEqual([]);
    // Remote's non-conflicting file is now present locally (no data lost).
    expect(existsSync(join(work, 'b.md'))).toBe(true);
  });

  it('records an unreachable remote without crashing', async () => {
    writeFile(work, 'a.md', 'x');
    const result = await runSyncCycle(
      target({ path: work, remote: join(root, 'does-not-exist.git') })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreachable');
    // The local commit still happened - CRUD never blocks on sync.
    expect(result.committed).toBe(true);
    expect(g(work, ['log', '--oneline']).trim().length).toBeGreaterThan(0);
  });

  it('returns a clean no-op when the vault directory does not exist yet', async () => {
    const result = await runSyncCycle(target({ path: join(root, 'ghost'), remote: bare }));
    expect(result).toMatchObject({ ok: true, committed: false, pushed: false });
  });
});
