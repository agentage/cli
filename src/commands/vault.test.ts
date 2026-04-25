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
});
