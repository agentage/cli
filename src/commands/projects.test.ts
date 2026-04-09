import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../projects/projects.js', () => ({
  loadProjects: vi.fn(),
  addProject: vi.fn(),
  removeProject: vi.fn(),
  discoverProjects: vi.fn(),
  getWorktrees: vi.fn(),
  pruneClones: vi.fn(),
}));

import {
  loadProjects,
  addProject,
  removeProject,
  discoverProjects,
  getWorktrees,
  pruneClones,
} from '../projects/projects.js';
import { registerProjects } from './projects.js';

const mockLoadProjects = vi.mocked(loadProjects);
const mockAddProject = vi.mocked(addProject);
const mockRemoveProject = vi.mocked(removeProject);
const mockDiscoverProjects = vi.mocked(discoverProjects);
const mockGetWorktrees = vi.mocked(getWorktrees);
const mockPruneClones = vi.mocked(pruneClones);

describe('projects command', () => {
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

    program = new Command();
    program.exitOverride();
    registerProjects(program);
  });

  describe('list (default)', () => {
    it('shows hint when no projects exist', async () => {
      mockLoadProjects.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects']);

      expect(logs.some((l) => l.includes('No projects tracked'))).toBe(true);
      expect(logs.some((l) => l.includes('discover'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('lists projects with worktree counts', async () => {
      mockLoadProjects.mockReturnValue([
        { name: 'cli', path: '/home/user/cli', discovered: false },
        { name: 'web', path: '/home/user/web', discovered: true },
      ]);
      mockGetWorktrees.mockImplementation((path: string) => {
        if (path === '/home/user/cli') return [{ branch: 'main', path: '/home/user/cli' }];
        return [];
      });

      await program.parseAsync(['node', 'agentage', 'projects']);

      expect(logs.some((l) => l.includes('cli'))).toBe(true);
      expect(logs.some((l) => l.includes('web'))).toBe(true);
      expect(logs.some((l) => l.includes('manual'))).toBe(true);
      expect(logs.some((l) => l.includes('discovered'))).toBe(true);
      expect(logs.some((l) => l.includes('2 projects'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('outputs JSON with --json flag', async () => {
      mockLoadProjects.mockReturnValue([
        { name: 'cli', path: '/home/user/cli', discovered: false },
      ]);
      mockGetWorktrees.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'list', '--json']);

      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('cli');
      expect(parsed[0].worktrees).toBe(0);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('outputs empty JSON array when no projects with --json', async () => {
      mockLoadProjects.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'list', '--json']);

      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toEqual([]);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('add', () => {
    it('adds a project successfully', async () => {
      mockAddProject.mockReturnValue({
        name: 'my-project',
        path: '/tmp/my-project',
        discovered: false,
      });

      await program.parseAsync(['node', 'agentage', 'projects', 'add', '/tmp/my-project']);

      expect(mockAddProject).toHaveBeenCalledWith('/tmp/my-project');
      expect(logs.some((l) => l.includes('Added project: my-project'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('handles errors when adding with exit code 1', async () => {
      mockAddProject.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      await program.parseAsync(['node', 'agentage', 'projects', 'add', '/tmp/bad']);

      expect(errorLogs.some((l) => l.includes('Not a git repository'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('remove', () => {
    it('removes a project successfully', async () => {
      mockRemoveProject.mockReturnValue(true);

      await program.parseAsync(['node', 'agentage', 'projects', 'remove', 'cli']);

      expect(mockRemoveProject).toHaveBeenCalledWith('cli');
      expect(logs.some((l) => l.includes('Removed project: cli'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('reports not found with exit code 1', async () => {
      mockRemoveProject.mockReturnValue(false);

      await program.parseAsync(['node', 'agentage', 'projects', 'remove', 'nonexistent']);

      expect(errorLogs.some((l) => l.includes('Project not found: nonexistent'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('discover', () => {
    it('finds new projects', async () => {
      mockLoadProjects.mockReturnValue([]);
      mockDiscoverProjects.mockReturnValue([
        { name: 'proj-a', path: '/tmp/root/proj-a', discovered: true },
        { name: 'proj-b', path: '/tmp/root/proj-b', discovered: true },
      ]);

      await program.parseAsync(['node', 'agentage', 'projects', 'discover', '/tmp/root']);

      expect(mockDiscoverProjects).toHaveBeenCalledWith('/tmp/root');
      expect(logs.some((l) => l.includes('Discovered 2 new project(s)'))).toBe(true);
      expect(logs.some((l) => l.includes('proj-a'))).toBe(true);
      expect(logs.some((l) => l.includes('proj-b'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('defaults to cwd when no path given', async () => {
      mockLoadProjects.mockReturnValue([]);
      mockDiscoverProjects.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'discover']);

      expect(mockDiscoverProjects).toHaveBeenCalledWith(expect.any(String));
      expect(logs.some((l) => l.includes('No new projects discovered'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('reports when no new projects found', async () => {
      mockLoadProjects.mockReturnValue([
        { name: 'existing', path: '/tmp/root/existing', discovered: true },
      ]);
      mockDiscoverProjects.mockReturnValue([
        { name: 'existing', path: '/tmp/root/existing', discovered: true },
      ]);

      await program.parseAsync(['node', 'agentage', 'projects', 'discover', '/tmp/root']);

      expect(logs.some((l) => l.includes('No new projects discovered'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('info', () => {
    it('shows project details with worktrees', async () => {
      mockLoadProjects.mockReturnValue([
        { name: 'cli', path: '/home/user/cli', discovered: false },
      ]);
      mockGetWorktrees.mockReturnValue([
        { branch: 'main', path: '/home/user/cli' },
        { branch: 'feat/test', path: '/home/user/cli-feat-test' },
      ]);

      await program.parseAsync(['node', 'agentage', 'projects', 'info', 'cli']);

      expect(logs.some((l) => l.includes('Name:') && l.includes('cli'))).toBe(true);
      expect(logs.some((l) => l.includes('Path:') && l.includes('/home/user/cli'))).toBe(true);
      expect(logs.some((l) => l.includes('manual'))).toBe(true);
      expect(logs.some((l) => l.includes('main'))).toBe(true);
      expect(logs.some((l) => l.includes('feat/test'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('shows not found for unknown project with exit code 1', async () => {
      mockLoadProjects.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'info', 'nope']);

      expect(errorLogs.some((l) => l.includes('Project not found: nope'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('shows project info with no worktrees', async () => {
      mockLoadProjects.mockReturnValue([{ name: 'web', path: '/home/user/web', discovered: true }]);
      mockGetWorktrees.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'info', 'web']);

      expect(logs.some((l) => l.includes('none'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('outputs JSON with --json flag', async () => {
      mockLoadProjects.mockReturnValue([
        { name: 'cli', path: '/home/user/cli', discovered: false },
      ]);
      mockGetWorktrees.mockReturnValue([{ branch: 'main', path: '/home/user/cli' }]);

      await program.parseAsync(['node', 'agentage', 'projects', 'info', 'cli', '--json']);

      const parsed = JSON.parse(logs[0]!);
      expect(parsed.name).toBe('cli');
      expect(parsed.worktrees).toHaveLength(1);
      expect(parsed.worktrees[0].branch).toBe('main');
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('shows remote URL when set', async () => {
      mockLoadProjects.mockReturnValue([
        {
          name: 'cli',
          path: '/home/user/cli',
          discovered: true,
          remote: 'git@github.com:agentage/cli.git',
        },
      ]);
      mockGetWorktrees.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'info', 'cli']);

      expect(logs.some((l) => l.includes('git@github.com:agentage/cli.git'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('prune', () => {
    it('removes stale clones', async () => {
      mockPruneClones.mockReturnValue(['/home/user/.agentage/clones/old-repo']);

      await program.parseAsync(['node', 'agentage', 'projects', 'prune']);

      expect(mockPruneClones).toHaveBeenCalledWith(30);
      expect(logs.some((l) => l.includes('Pruned 1 stale clone(s)'))).toBe(true);
      expect(logs.some((l) => l.includes('old-repo'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('reports nothing to prune', async () => {
      mockPruneClones.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'prune']);

      expect(logs.some((l) => l.includes('Nothing to prune'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('accepts --days option', async () => {
      mockPruneClones.mockReturnValue([]);

      await program.parseAsync(['node', 'agentage', 'projects', 'prune', '--days', '7']);

      expect(mockPruneClones).toHaveBeenCalledWith(7);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });
});
