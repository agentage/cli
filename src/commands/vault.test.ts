import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/action-client.js', () => ({
  invokeAction: vi.fn(),
}));

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn().mockResolvedValue(undefined),
}));

import { invokeAction } from '../utils/action-client.js';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { registerVaults } from './vault.js';

const mockInvoke = vi.mocked(invokeAction);
const mockEnsureDaemon = vi.mocked(ensureDaemon);

describe('vault command', () => {
  let program: Command;
  let logs: string[];
  let errorLogs: string[];
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    errorLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    mockExit.mockClear();
    program = new Command();
    program.exitOverride();
    registerVaults(program);
  });

  describe('vault list', () => {
    it('shows empty state when no vaults registered', async () => {
      mockInvoke.mockResolvedValueOnce({ vaults: [] });
      await program.parseAsync(['node', 'agentage', 'vault', 'list']);
      expect(mockEnsureDaemon).toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith('vault:list', {}, ['vault.read']);
      expect(logs.some((l) => l.includes('No vaults registered'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('prints a table when vaults exist', async () => {
      mockInvoke.mockResolvedValueOnce({
        vaults: [
          {
            slug: 'notes',
            uuid: 'uuid-1',
            path: '/home/u/notes',
            fileCount: 42,
            indexedAt: '2026-04-25T00:00:00.000Z',
          },
        ],
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'list']);
      const all = logs.join('\n');
      expect(all).toContain('notes');
      expect(all).toContain('/home/u/notes');
      expect(all).toContain('42');
    });

    it('emits JSON when --json passed', async () => {
      mockInvoke.mockResolvedValueOnce({
        vaults: [{ slug: 'a', uuid: 'u1', path: '/p', fileCount: 1, indexedAt: null }],
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'list', '--json']);
      expect(logs[0]).toContain('"slug": "a"');
    });
  });

  describe('vault add', () => {
    it('passes path + slug to vault:add action', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        uuid: 'u1',
        path: '/home/u/notes',
        fileCount: 5,
      });
      await program.parseAsync([
        'node',
        'agentage',
        'vault',
        'add',
        '/home/u/notes',
        '--slug',
        'notes',
      ]);
      expect(mockInvoke).toHaveBeenCalledWith(
        'vault:add',
        expect.objectContaining({ path: '/home/u/notes', slug: 'notes' }),
        ['vault.admin']
      );
      expect(logs.some((l) => l.includes('Added vault'))).toBe(true);
    });

    it('passes scope when non-default', async () => {
      mockInvoke.mockResolvedValueOnce({ slug: 's', uuid: 'u', path: '/p', fileCount: 0 });
      await program.parseAsync(['node', 'agentage', 'vault', 'add', '/p', '--scope', 'shared']);
      const call = mockInvoke.mock.calls[0];
      expect(call?.[1]).toMatchObject({ scope: 'shared' });
    });

    it('omits scope when local (the default)', async () => {
      mockInvoke.mockResolvedValueOnce({ slug: 's', uuid: 'u', path: '/p', fileCount: 0 });
      await program.parseAsync(['node', 'agentage', 'vault', 'add', '/p']);
      const call = mockInvoke.mock.calls[0];
      expect(call?.[1]).not.toHaveProperty('scope');
    });

    it('reports failure and exits 1 on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('INVALID_INPUT: path is not a directory'));
      await program.parseAsync(['node', 'agentage', 'vault', 'add', '/nope']);
      expect(errorLogs.some((l) => l.includes('Failed to add vault'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('vault remove', () => {
    it('invokes vault:remove with slug and reports success', async () => {
      mockInvoke.mockResolvedValueOnce({ slug: 'gone', removed: true });
      await program.parseAsync(['node', 'agentage', 'vault', 'remove', 'gone']);
      expect(mockInvoke).toHaveBeenCalledWith('vault:remove', { slug: 'gone' }, ['vault.admin']);
      expect(logs.some((l) => l.includes('Removed vault'))).toBe(true);
      expect(logs.some((l) => l.includes('files on disk were not touched'))).toBe(true);
    });
  });

  describe('vault reindex', () => {
    it('reports stats from reindex action', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'r',
        added: 2,
        modified: 1,
        removed: 0,
        unchanged: 5,
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'reindex', 'r']);
      expect(mockInvoke).toHaveBeenCalledWith('vault:reindex', { slug: 'r' }, ['vault.admin']);
      const all = logs.join('\n');
      expect(all).toContain('Reindexed vault');
      expect(all).toContain('added=2');
      expect(all).toContain('modified=1');
      expect(all).toContain('unchanged=5');
    });
  });

  describe('vault files', () => {
    it('lists files with size + mtime', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        files: [
          { path: 'a.md', size: 10, mtime: 1700000000000, sha256: 'h1' },
          { path: 'b.md', size: 20, mtime: 1700000001000, sha256: 'h2' },
        ],
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'files', 'notes']);
      expect(mockInvoke).toHaveBeenCalledWith('vault:files', { slug: 'notes', limit: 100 }, [
        'vault.read',
      ]);
      const all = logs.join('\n');
      expect(all).toContain('a.md');
      expect(all).toContain('b.md');
      expect(all).toContain('2 file(s)');
    });

    it('passes prefix when given', async () => {
      mockInvoke.mockResolvedValueOnce({ slug: 'notes', files: [] });
      await program.parseAsync([
        'node',
        'agentage',
        'vault',
        'files',
        'notes',
        '--prefix',
        'inbox/',
      ]);
      const call = mockInvoke.mock.calls[0];
      expect(call?.[1]).toMatchObject({ slug: 'notes', prefix: 'inbox/' });
    });

    it('--json prints raw array', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        files: [{ path: 'a.md', size: 1, mtime: 1, sha256: 'h' }],
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'files', 'notes', '--json']);
      expect(logs[0]).toContain('"path": "a.md"');
    });
  });

  describe('vault read', () => {
    it('writes file content to stdout', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        path: 'a.md',
        content: 'hello world\n',
        size: 12,
        mtime: 1,
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'read', 'notes', 'a.md']);
      expect(mockInvoke).toHaveBeenCalledWith('vault:read', { slug: 'notes', path: 'a.md' }, [
        'vault.read',
      ]);
      expect(stdoutSpy).toHaveBeenCalledWith('hello world\n');
      stdoutSpy.mockRestore();
    });

    it('appends trailing newline if file lacks one', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        path: 'a.md',
        content: 'no newline',
        size: 10,
        mtime: 1,
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'read', 'notes', 'a.md']);
      expect(stdoutSpy).toHaveBeenCalledWith('no newline');
      expect(stdoutSpy).toHaveBeenCalledWith('\n');
      stdoutSpy.mockRestore();
    });
  });

  describe('vault search', () => {
    it('prints ranked hits', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        query: 'rust',
        hits: [
          { path: 'a.md', score: -1.5, snippet: 'about <<rust>> language' },
          { path: 'b.md', score: -0.8, snippet: 'mention of <<rust>>' },
        ],
      });
      await program.parseAsync(['node', 'agentage', 'vault', 'search', 'notes', 'rust']);
      expect(mockInvoke).toHaveBeenCalledWith(
        'vault:search',
        { slug: 'notes', query: 'rust', limit: 20 },
        ['vault.read']
      );
      const all = logs.join('\n');
      expect(all).toContain('a.md');
      expect(all).toContain('rust');
      expect(all).toContain('2 hit(s)');
    });

    it('joins multi-word query', async () => {
      mockInvoke.mockResolvedValueOnce({ slug: 'notes', query: 'foo bar', hits: [] });
      await program.parseAsync(['node', 'agentage', 'vault', 'search', 'notes', 'foo', 'bar']);
      const call = mockInvoke.mock.calls[0];
      expect(call?.[1]).toMatchObject({ query: 'foo bar' });
    });

    it('reports no matches gracefully', async () => {
      mockInvoke.mockResolvedValueOnce({ slug: 'notes', query: 'x', hits: [] });
      await program.parseAsync(['node', 'agentage', 'vault', 'search', 'notes', 'x']);
      const all = logs.join('\n');
      expect(all).toContain('No matches');
    });
  });

  describe('vault edit', () => {
    it('passes --content to vault:edit with vault.write', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        path: 'inbox/2026-04-25-120000-abcd.md',
        mode: 'inbox-dated',
        bytesWritten: 5,
      });
      await program.parseAsync([
        'node',
        'agentage',
        'vault',
        'edit',
        'notes',
        '--content',
        'hello',
      ]);
      expect(mockInvoke).toHaveBeenCalledWith('vault:edit', { slug: 'notes', content: 'hello' }, [
        'vault.write',
      ]);
      const all = logs.join('\n');
      expect(all).toContain('Wrote 5 bytes');
    });

    it('passes --mode and --path through', async () => {
      mockInvoke.mockResolvedValueOnce({
        slug: 'notes',
        path: 'a.md',
        mode: 'overwrite',
        bytesWritten: 3,
      });
      await program.parseAsync([
        'node',
        'agentage',
        'vault',
        'edit',
        'notes',
        '--content',
        'foo',
        '--mode',
        'overwrite',
        '--path',
        'a.md',
      ]);
      const call = mockInvoke.mock.calls[0];
      expect(call?.[1]).toMatchObject({ mode: 'overwrite', path: 'a.md' });
    });

    it('errors if no --content and stdin is a TTY', async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      try {
        await program.parseAsync(['node', 'agentage', 'vault', 'edit', 'notes']);
        expect(errorLogs.some((l) => l.includes('No content'))).toBe(true);
        expect(mockExit).toHaveBeenCalledWith(1);
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });
});
