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
