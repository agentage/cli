import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// The 6 memory verbs run entirely over @agentage/memory-core's local git backend (fs + git,
// zero network). Blackhole any egress via unroutable proxies to prove offline. @p0
const BLACKHOLE = 'http://127.0.0.1:1';
const OFFLINE = {
  http_proxy: BLACKHOLE,
  https_proxy: BLACKHOLE,
  HTTP_PROXY: BLACKHOLE,
  HTTPS_PROXY: BLACKHOLE,
};

interface TreeEntry {
  type: 'file' | 'folder';
  path: string;
  entries?: TreeEntry[];
}

const treeFiles = (entries: TreeEntry[]): string[] =>
  entries.flatMap((e) => (e.type === 'file' ? [e.path] : e.entries ? treeFiles(e.entries) : []));

test.describe('offline memory CRUD @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('write -> search -> read -> edit -> list -> delete, no network', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      const add = await m.exec(['vault', 'add', 'main', '--local', vaultDir]);
      expect(add.code, add.stderr).toBe(0);

      const write = await m.exec([
        'memory',
        'write',
        'notes/q.md',
        '--body',
        'the quokka is a marsupial',
      ]);
      expect(write.code, write.stderr).toBe(0);

      const search = await m.exec(['memory', 'search', 'quokka', '--json']);
      expect(search.code, search.stderr).toBe(0);
      expect(JSON.parse(search.stdout).results.map((r: { path: string }) => r.path)).toEqual([
        'notes/q.md',
      ]);

      const read = await m.exec(['memory', 'read', 'notes/q.md']);
      expect(read.stdout).toContain('marsupial');

      const edit = await m.exec([
        'memory',
        'edit',
        'notes/q.md',
        '--old',
        'quokka',
        '--new',
        'wombat',
      ]);
      expect(edit.code, edit.stderr).toBe(0);
      expect((await m.exec(['memory', 'read', 'notes/q.md'])).stdout).toContain('wombat');

      const list = await m.exec(['memory', 'list', '--json']);
      expect(treeFiles(JSON.parse(list.stdout).entries)).toEqual(['notes/q.md']);

      const del = await m.exec(['memory', 'delete', 'notes/q.md']);
      expect(del.code, del.stderr).toBe(0);
      const after = await m.exec(['memory', 'list', '--json']);
      expect(treeFiles(JSON.parse(after.stdout).entries)).toHaveLength(0);

      // git-backed store: the vault folder is a repo carrying a commit per mutation
      // (write + edit + delete = 3).
      const log = execFileSync('git', ['-C', vaultDir, 'log', '--oneline'], { encoding: 'utf-8' });
      expect(log.trim().split('\n').length).toBeGreaterThanOrEqual(3);
    } finally {
      m.cleanup();
    }
  });

  test('a duplicate str_replace target reports the canonical error', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      await m.exec(['vault', 'add', 'main', '--local', join(m.configDir, 'main')]);
      await m.exec(['memory', 'write', 'd.md', '--body', 'x x']);
      const res = await m.exec(['memory', 'edit', 'd.md', '--old', 'x', '--new', 'y']);
      expect(res.code).not.toBe(0);
      expect(res.stderr + res.stdout).toContain('Multiple occurrences');
    } finally {
      m.cleanup();
    }
  });

  test('a write carrying an obvious secret is refused; ordinary prose still writes', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);

      // Prose that merely mentions "password" is not a false positive - it writes, giving a HEAD.
      const clean = await m.exec([
        'memory',
        'write',
        'ops/note.md',
        '--body',
        'Change the wifi password before the demo.',
      ]);
      expect(clean.code, clean.stderr).toBe(0);
      const head = execFileSync('git', ['-C', vaultDir, 'rev-parse', 'HEAD'], {
        encoding: 'utf-8',
      }).trim();

      // A fake-but-shape-valid AWS key is refused with the canonical message and a non-zero exit.
      const secret = await m.exec([
        'memory',
        'write',
        'sec/aws.md',
        '--body',
        'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      ]);
      expect(secret.code).not.toBe(0);
      expect(secret.stderr + secret.stdout).toContain('Refused: this appears to contain');

      // Nothing was persisted: no file, the read fails, and HEAD did not move.
      expect(existsSync(join(vaultDir, 'sec', 'aws.md'))).toBe(false);
      expect((await m.exec(['memory', 'read', 'sec/aws.md'])).code).not.toBe(0);
      expect(
        execFileSync('git', ['-C', vaultDir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()
      ).toBe(head);
    } finally {
      m.cleanup();
    }
  });

  test('read clamps an oversized doc for display but the stored file stays whole', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);

      // A body over the 64 KB read budget (no digits/secret shapes so the write is accepted);
      // passed on argv, comfortably under the OS per-arg limit.
      const body = 'durable notes and knowledge kept here forever '.repeat(1600);
      const originalBytes = Buffer.byteLength(body, 'utf-8');
      expect(originalBytes).toBeGreaterThan(65536);
      expect((await m.exec(['memory', 'write', 'big/tome.md', '--body', body])).code).toBe(0);

      const read = await m.exec(['memory', 'read', 'big/tome.md']);
      expect(read.code, read.stderr).toBe(0);
      // The printed body is clamped to the budget plus the marker, well under the original.
      expect(read.stdout).toContain('[Truncated for display:');
      expect(read.stdout).toContain(`of ${originalBytes} bytes`);
      expect(Buffer.byteLength(read.stdout, 'utf-8')).toBeLessThan(originalBytes);

      // The stored file on disk is the full, unclamped original - the marker never touches it.
      const onDisk = readFileSync(join(vaultDir, 'big', 'tome.md'), 'utf-8');
      expect(Buffer.byteLength(onDisk, 'utf-8')).toBe(originalBytes);
      expect(onDisk).not.toContain('[Truncated for display:');
    } finally {
      m.cleanup();
    }
  });
});
