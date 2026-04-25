import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeToVault } from './writer.js';

describe('writeToVault', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'agentage-writer-'));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  describe('inbox-dated', () => {
    it('writes to inbox/<date-time-nanoid>.md', async () => {
      const now = new Date('2026-04-25T13:45:30Z');
      const result = await writeToVault(vaultPath, 'note body', 'inbox-dated', undefined, now);
      expect(result.relPath).toMatch(/^inbox\/2026-04-25-134530-[0-9a-f]{8}\.md$/);
      expect(result.bytesWritten).toBe(9);
      const content = await readFile(join(vaultPath, result.relPath), 'utf-8');
      expect(content).toBe('note body');
    });

    it('two writes in the same second produce distinct files via the nanoid', async () => {
      const now = new Date('2026-04-25T13:45:30Z');
      const a = await writeToVault(vaultPath, 'a', 'inbox-dated', undefined, now);
      const b = await writeToVault(vaultPath, 'b', 'inbox-dated', undefined, now);
      expect(a.relPath).not.toBe(b.relPath);
    });
  });

  describe('append-daily', () => {
    it('creates daily file with title + first block when not present', async () => {
      const now = new Date('2026-04-25T09:15:00Z');
      const result = await writeToVault(
        vaultPath,
        'morning thought',
        'append-daily',
        undefined,
        now
      );
      expect(result.relPath).toBe('daily/2026-04-25.md');
      const content = await readFile(join(vaultPath, result.relPath), 'utf-8');
      expect(content).toBe('# 2026-04-25\n\n## 09:15\n\nmorning thought\n');
    });

    it('appends second block when file exists', async () => {
      const morning = new Date('2026-04-25T09:15:00Z');
      const evening = new Date('2026-04-25T21:30:00Z');
      await writeToVault(vaultPath, 'morning', 'append-daily', undefined, morning);
      await writeToVault(vaultPath, 'evening', 'append-daily', undefined, evening);
      const content = await readFile(join(vaultPath, 'daily/2026-04-25.md'), 'utf-8');
      expect(content).toBe('# 2026-04-25\n\n## 09:15\n\nmorning\n\n## 21:30\n\nevening\n');
    });

    it('appends correctly when existing file lacks trailing newline', async () => {
      await writeFile(join(vaultPath, 'daily/2026-04-25.md').replace('daily/', ''), '');
      // Pre-create a file without trailing newline
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(vaultPath, 'daily'), { recursive: true });
      await writeFile(join(vaultPath, 'daily/2026-04-25.md'), '# 2026-04-25\n\nbare note');
      const now = new Date('2026-04-25T12:00:00Z');
      await writeToVault(vaultPath, 'follow-up', 'append-daily', undefined, now);
      const content = await readFile(join(vaultPath, 'daily/2026-04-25.md'), 'utf-8');
      expect(content).toContain('bare note\n\n## 12:00');
      expect(content).toContain('follow-up');
    });
  });

  describe('overwrite', () => {
    it('writes to the explicit path', async () => {
      const result = await writeToVault(vaultPath, 'replaces it', 'overwrite', 'notes/exact.md');
      expect(result.relPath).toBe('notes/exact.md');
      const content = await readFile(join(vaultPath, 'notes/exact.md'), 'utf-8');
      expect(content).toBe('replaces it');
    });

    it('throws when path is missing', async () => {
      await expect(writeToVault(vaultPath, 'x', 'overwrite', undefined)).rejects.toThrow(
        /requires path/
      );
    });

    it('rejects path-traversal attempts', async () => {
      await expect(writeToVault(vaultPath, 'x', 'overwrite', '../../etc/passwd')).rejects.toThrow(
        /escapes/
      );
    });
  });

  it('returns sha256 + size + mtime in change', async () => {
    const result = await writeToVault(vaultPath, 'hello', 'overwrite', 'a.md');
    expect(result.change.path).toBe('a.md');
    expect(result.change.content).toBe('hello');
    expect(result.change.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.change.size).toBe(5);
    expect(result.change.mtime).toBeGreaterThan(0);
  });
});
