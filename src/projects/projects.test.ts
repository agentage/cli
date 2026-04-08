import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  getConfigDir: vi.fn().mockReturnValue('/mock/config'),
}));

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  loadProjects,
  saveProjects,
  addProject,
  removeProject,
  discoverProjects,
  getWorktrees,
  resolveProject,
} from './projects.js';
import type { Project } from './projects.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadProjects', () => {
  it('returns empty array when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadProjects()).toEqual([]);
  });

  it('parses projects from file', () => {
    const projects: Project[] = [{ name: 'cli', path: '/projects/cli', discovered: false }];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(projects));
    expect(loadProjects()).toEqual(projects);
  });

  it('returns empty array on parse error', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not json');
    expect(loadProjects()).toEqual([]);
  });
});

describe('saveProjects', () => {
  it('writes valid JSON with 2-space indent and trailing newline', () => {
    const projects: Project[] = [{ name: 'cli', path: '/projects/cli', discovered: false }];
    saveProjects(projects);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock/config/projects.json',
      JSON.stringify(projects, null, 2) + '\n',
      'utf-8',
    );
  });
});

describe('addProject', () => {
  it('adds a new project with basename as name', () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('projects.json')) return false;
      if (String(p).endsWith('package.json')) return false;
      return false;
    });

    const project = addProject('/projects/my-app');

    expect(project.name).toBe('my-app');
    expect(project.path).toBe('/projects/my-app');
    expect(project.discovered).toBe(false);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('derives name from package.json stripping scope', () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('projects.json')) return false;
      if (String(p).endsWith('package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@agentage/cli' }));

    const project = addProject('/projects/cli');
    expect(project.name).toBe('cli');
  });

  it('deduplicates by path', () => {
    const existing: Project[] = [{ name: 'cli', path: '/projects/cli', discovered: false }];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const project = addProject('/projects/cli');

    expect(project).toEqual(existing[0]);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('removeProject', () => {
  it('removes existing project and returns true', () => {
    const projects: Project[] = [{ name: 'cli', path: '/projects/cli', discovered: false }];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(projects));

    expect(removeProject('cli')).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('returns false for unknown project', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([]));

    expect(removeProject('unknown')).toBe(false);
  });
});

describe('discoverProjects', () => {
  it('finds git repos and skips non-git dirs', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/repo-a/.git') return true;
      if (s === '/root/no-git/.git') return false;
      if (s.endsWith('package.json')) return false;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'repo-a', isDirectory: () => true } as never,
      { name: 'no-git', isDirectory: () => true } as never,
      { name: 'file.txt', isDirectory: () => false } as never,
    ]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects('/root');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('repo-a');
    expect(result[0].discovered).toBe(true);
  });

  it('skips worktrees where .git is a file', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/worktree/.git') return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'worktree', isDirectory: () => true } as never,
    ]);
    mockStatSync.mockReturnValue({ isDirectory: () => false } as never);

    const result = discoverProjects('/root');
    expect(result).toHaveLength(0);
  });

  it('derives name from package.json when available', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/my-lib/.git') return true;
      if (s === '/root/my-lib/package.json') return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'my-lib', isDirectory: () => true } as never,
    ]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@scope/my-lib' }));

    const result = discoverProjects('/root');
    expect(result[0].name).toBe('my-lib');
  });

  it('merges with existing projects without overwriting', () => {
    const existing: Project[] = [
      { name: 'manual', path: '/root/repo-a', discovered: false },
    ];
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return true;
      if (s === '/root/repo-a/.git') return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    mockReaddirSync.mockReturnValue([
      { name: 'repo-a', isDirectory: () => true } as never,
    ]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects('/root');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('manual');
    expect(result[0].discovered).toBe(false);
  });
});

describe('getWorktrees', () => {
  it('parses git worktree list output and skips main', () => {
    const porcelain = [
      'worktree /projects/cli',
      'HEAD abc123',
      'branch refs/heads/master',
      '',
      'worktree /projects/cli/.worktrees/feat-x',
      'HEAD def456',
      'branch refs/heads/feat-x',
      '',
      'worktree /projects/cli/.worktrees/fix-y',
      'HEAD ghi789',
      'branch refs/heads/fix-y',
    ].join('\n');

    mockExecSync.mockReturnValue(porcelain);

    const result = getWorktrees('/projects/cli');

    expect(result).toEqual([
      { branch: 'feat-x', path: '/projects/cli/.worktrees/feat-x' },
      { branch: 'fix-y', path: '/projects/cli/.worktrees/fix-y' },
    ]);
  });

  it('returns empty array on error', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    expect(getWorktrees('/not-a-repo')).toEqual([]);
  });
});

describe('resolveProject', () => {
  const projects: Project[] = [
    { name: 'cli', path: '/projects/cli', discovered: false },
    { name: 'web', path: '/projects/web', discovered: true },
  ];

  it('uses cwd and matches project by path prefix', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/projects/cli/src';

    const ref = resolveProject(undefined, projects);
    expect(ref).toEqual({ name: 'cli', path: '/projects/cli' });

    process.cwd = originalCwd;
  });

  it('uses cwd and falls back to basename when no match', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/other/random-dir';

    const ref = resolveProject(undefined, projects);
    expect(ref).toEqual({ name: 'random-dir', path: '/other/random-dir' });

    process.cwd = originalCwd;
  });

  it('resolves name:branch with worktree lookup', () => {
    const porcelain = [
      'worktree /projects/cli',
      'HEAD abc',
      'branch refs/heads/master',
      '',
      'worktree /projects/cli/.wt/feat-x',
      'HEAD def',
      'branch refs/heads/feat-x',
    ].join('\n');
    mockExecSync.mockReturnValue(porcelain);

    const ref = resolveProject('cli:feat-x', projects);
    expect(ref).toEqual({
      name: 'cli',
      path: '/projects/cli/.wt/feat-x',
      branch: 'feat-x',
    });
  });

  it('throws when project not found for name:branch', () => {
    expect(() => resolveProject('unknown:feat', projects)).toThrow('Project not found: unknown');
  });

  it('throws when worktree branch not found', () => {
    mockExecSync.mockReturnValue('worktree /projects/cli\nHEAD abc\nbranch refs/heads/master\n');

    expect(() => resolveProject('cli:nonexistent', projects)).toThrow(
      'Worktree not found for branch: nonexistent',
    );
  });

  it('resolves absolute path directly', () => {
    const ref = resolveProject('/some/absolute/path', projects);
    expect(ref).toEqual({ name: 'path', path: '/some/absolute/path' });
  });

  it('resolves by project name', () => {
    const ref = resolveProject('web', projects);
    expect(ref).toEqual({ name: 'web', path: '/projects/web' });
  });

  it('throws when project name not found', () => {
    expect(() => resolveProject('nonexistent', projects)).toThrow(
      'Project not found: nonexistent',
    );
  });
});
