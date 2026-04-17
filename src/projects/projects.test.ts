import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  getConfigDir: vi.fn().mockReturnValue('/mock/config'),
}));

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import {
  loadProjects,
  saveProjects,
  addProject,
  removeProject,
  discoverProjects,
  getWorktrees,
  resolveProject,
  isGitUrl,
  normalizeGitUrl,
  getClonePath,
  cloneOrFetch,
  resolveRemoteProject,
  pruneClones,
} from './projects.js';
import type { Project } from './projects.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockRmSync = vi.mocked(rmSync);
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

  it('rewrites file and returns empty array on parse error', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not json');
    expect(loadProjects()).toEqual([]);
    expect(mockWriteFileSync).toHaveBeenCalledWith('/mock/config/projects.json', '[]\n', 'utf-8');
  });

  it('rewrites file and returns empty array when schema is foreign (e.g. desktop)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ $version: 1, projects: [{ id: 'x', name: 'desktop', path: '/d' }] })
    );
    expect(loadProjects()).toEqual([]);
    expect(mockWriteFileSync).toHaveBeenCalledWith('/mock/config/projects.json', '[]\n', 'utf-8');
  });

  it('rewrites file when array entries do not match the Project schema', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([{ id: 'x', name: 'desktop' }]));
    expect(loadProjects()).toEqual([]);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('drops entries whose path no longer exists on disk and persists', () => {
    const projects: Project[] = [
      { name: 'alive', path: '/projects/alive', discovered: true, remote: 'git@x:a/b.git' },
      { name: 'ghost', path: '/projects/ghost', discovered: true },
    ];
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return true;
      return s === '/projects/alive';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(projects));

    const result = loadProjects();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('alive');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock/config/projects.json',
      expect.stringContaining('"alive"'),
      'utf-8'
    );
  });

  it('backfills missing remote via git origin and persists', () => {
    const projects: Project[] = [{ name: 'cli', path: '/projects/cli', discovered: true }];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(projects));
    mockExecSync.mockImplementation((cmd) => {
      if (String(cmd).includes('git remote get-url origin')) {
        return 'https://github.com/agentage/cli.git\n';
      }
      throw new Error('not expected');
    });

    const result = loadProjects();

    expect(result[0].remote).toBe('https://github.com/agentage/cli.git');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('does not rewrite when all paths exist and remotes already set', () => {
    const projects: Project[] = [
      { name: 'cli', path: '/projects/cli', discovered: true, remote: 'git@x:a/b.git' },
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(projects));

    expect(loadProjects()).toEqual(projects);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('saveProjects', () => {
  it('writes valid JSON with 2-space indent and trailing newline', () => {
    const projects: Project[] = [{ name: 'cli', path: '/projects/cli', discovered: false }];
    saveProjects(projects);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock/config/projects.json',
      JSON.stringify(projects, null, 2) + '\n',
      'utf-8'
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
    const existing: Project[] = [
      { name: 'cli', path: '/projects/cli', discovered: false, remote: 'x' },
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const project = addProject('/projects/cli');

    expect(project).toEqual(existing[0]);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('captures origin remote URL when present', () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('projects.json')) return false;
      if (String(p).endsWith('package.json')) return false;
      return false;
    });
    mockExecSync.mockImplementation((cmd) => {
      if (String(cmd).includes('git remote get-url origin')) {
        return 'https://github.com/agentage/cli.git\n';
      }
      throw new Error('not expected');
    });

    const project = addProject('/projects/cli');
    expect(project.remote).toBe('https://github.com/agentage/cli.git');
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
    mockReaddirSync.mockReturnValue([{ name: 'worktree', isDirectory: () => true } as never]);
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
    mockReaddirSync.mockReturnValue([{ name: 'my-lib', isDirectory: () => true } as never]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@scope/my-lib' }));

    const result = discoverProjects('/root');
    expect(result[0].name).toBe('my-lib');
  });

  it('merges with existing projects without overwriting', () => {
    const existing: Project[] = [
      { name: 'manual', path: '/root/repo-a', discovered: false, remote: 'x' },
    ];
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return true;
      if (s === '/root/repo-a') return true;
      if (s === '/root/repo-a/.git') return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    mockReaddirSync.mockReturnValue([{ name: 'repo-a', isDirectory: () => true } as never]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects('/root');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('manual');
    expect(result[0].discovered).toBe(false);
  });

  it('captures origin remote URL on newly-discovered projects', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/cli/.git') return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([{ name: 'cli', isDirectory: () => true } as never]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);
    mockExecSync.mockImplementation((cmd) => {
      if (String(cmd).includes('git remote get-url origin')) {
        return 'git@github.com:agentage/cli.git\n';
      }
      throw new Error('not expected');
    });

    const result = discoverProjects('/root');
    expect(result).toHaveLength(1);
    expect(result[0].remote).toBe('git@github.com:agentage/cli.git');
  });

  it('omits remote when origin is not configured', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/local/.git') return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([{ name: 'local', isDirectory: () => true } as never]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);
    mockExecSync.mockImplementation(() => {
      throw new Error('fatal: No such remote');
    });

    const result = discoverProjects('/root');
    expect(result).toHaveLength(1);
    expect(result[0].remote).toBeUndefined();
  });

  it('accepts an array of roots and dedupes results', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/a/repo-x/.git') return true;
      if (s === '/b/repo-x/.git') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/a') return [{ name: 'repo-x', isDirectory: () => true }] as never;
      if (s === '/b') return [{ name: 'repo-x', isDirectory: () => true }] as never;
      return [];
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects(['/a', '/b']);
    expect(result.map((r) => r.path).sort()).toEqual(['/a/repo-x', '/b/repo-x']);
  });

  it('skips node_modules, .git, and other ignored dirs', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/keep/.git') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/root')
        return [
          { name: 'keep', isDirectory: () => true },
          { name: 'node_modules', isDirectory: () => true },
          { name: '.github', isDirectory: () => true },
          { name: '.claude', isDirectory: () => true },
          { name: 'dist', isDirectory: () => true },
        ] as never;
      return [];
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects('/root');

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/root/keep');
    // Sanity: readdirSync never called on ignored paths
    const readCalls = mockReaddirSync.mock.calls.map((c) => String(c[0]));
    expect(readCalls).not.toContain('/root/node_modules');
    expect(readCalls).not.toContain('/root/.github');
  });

  it('walks recursively to find nested git repos', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/group/inner/.git') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/root') return [{ name: 'group', isDirectory: () => true }] as never;
      if (s === '/root/group') return [{ name: 'inner', isDirectory: () => true }] as never;
      return [];
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects('/root');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/root/group/inner');
  });

  it('stops descending into a matched repo', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return false;
      if (s === '/root/outer/.git') return true;
      if (s === '/root/outer/sub/.git') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/root') return [{ name: 'outer', isDirectory: () => true }] as never;
      if (s === '/root/outer') return [{ name: 'sub', isDirectory: () => true }] as never;
      return [];
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);

    const result = discoverProjects('/root');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/root/outer');
  });

  it('backfills remote on existing entries that are missing it', () => {
    const existing: Project[] = [{ name: 'cli', path: '/root/cli', discovered: true }];
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('projects.json')) return true;
      if (s === '/root/cli') return true;
      if (s === '/root/cli/.git') return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    mockReaddirSync.mockReturnValue([{ name: 'cli', isDirectory: () => true } as never]);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as never);
    mockExecSync.mockImplementation((cmd) => {
      if (String(cmd).includes('git remote get-url origin')) {
        return 'https://github.com/agentage/cli.git\n';
      }
      throw new Error('not expected');
    });

    const result = discoverProjects('/root');
    expect(result).toHaveLength(1);
    expect(result[0].remote).toBe('https://github.com/agentage/cli.git');
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
      'Worktree not found for branch: nonexistent'
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
    expect(() => resolveProject('nonexistent', projects)).toThrow('Project not found: nonexistent');
  });

  it('resolves git URL through remote resolution', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('/mock/config/clones/github.com/org/repo')) return true;
      return false;
    });
    mockExecSync.mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes('fetch --all')) return '';
      if (c.includes('symbolic-ref')) return 'refs/heads/main';
      if (c.includes('worktree add')) return '';
      return '';
    });

    const ref = resolveProject('org/repo', []);
    expect(ref.name).toBe('repo');
    expect(ref.remote).toBe('https://github.com/org/repo.git');
    expect(ref.branch).toBe('main');
  });
});

describe('isGitUrl', () => {
  it('returns true for https git URLs', () => {
    expect(isGitUrl('https://github.com/org/repo')).toBe(true);
  });

  it('returns true for SSH git URLs', () => {
    expect(isGitUrl('git@github.com:org/repo')).toBe(true);
  });

  it('returns true for org/repo shorthand', () => {
    expect(isGitUrl('org/repo')).toBe(true);
  });

  it('returns false for plain project name', () => {
    expect(isGitUrl('my-project')).toBe(false);
  });

  it('returns false for absolute path', () => {
    expect(isGitUrl('/abs/path')).toBe(false);
  });

  it('returns true for org/repo:branch', () => {
    expect(isGitUrl('org/repo:branch')).toBe(true);
  });
});

describe('normalizeGitUrl', () => {
  it('converts org/repo shorthand to GitHub HTTPS', () => {
    expect(normalizeGitUrl('org/repo')).toEqual({
      url: 'https://github.com/org/repo.git',
    });
  });

  it('extracts branch from org/repo:branch', () => {
    expect(normalizeGitUrl('org/repo:feat/x')).toEqual({
      url: 'https://github.com/org/repo.git',
      branch: 'feat/x',
    });
  });

  it('keeps HTTPS URL as-is without branch', () => {
    expect(normalizeGitUrl('https://github.com/org/repo')).toEqual({
      url: 'https://github.com/org/repo',
    });
  });

  it('keeps SSH URL as-is', () => {
    expect(normalizeGitUrl('git@github.com:org/repo.git')).toEqual({
      url: 'git@github.com:org/repo.git',
    });
  });

  it('extracts branch from SSH URL with # separator', () => {
    expect(normalizeGitUrl('git@github.com:org/repo.git#main')).toEqual({
      url: 'git@github.com:org/repo.git',
      branch: 'main',
    });
  });
});

describe('getClonePath', () => {
  it('converts HTTPS URL to cache path', () => {
    const result = getClonePath('https://github.com/org/repo.git');
    expect(result).toBe('/mock/config/clones/github.com/org/repo');
  });

  it('converts SSH URL to same cache path', () => {
    const result = getClonePath('git@github.com:org/repo.git');
    expect(result).toBe('/mock/config/clones/github.com/org/repo');
  });
});

describe('cloneOrFetch', () => {
  it('clones bare repo when path does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = cloneOrFetch('https://github.com/org/repo.git');

    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('github.com/org/repo'), {
      recursive: true,
    });
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git clone --bare'),
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe' })
    );
    expect(result).toContain('github.com/org/repo');
  });

  it('fetches when bare clone already exists', () => {
    mockExistsSync.mockReturnValue(true);

    cloneOrFetch('https://github.com/org/repo.git');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git fetch --all --prune',
      expect.objectContaining({
        cwd: expect.stringContaining('github.com/org/repo'),
      })
    );
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe('resolveRemoteProject', () => {
  it('returns correct ProjectRef with name, path, branch, remote', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('/mock/config/clones/github.com/org/repo')) return true;
      if (s.includes('worktrees-checkout')) return false;
      return false;
    });
    mockExecSync.mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes('fetch --all')) return '';
      if (c.includes('symbolic-ref')) return 'refs/heads/main';
      if (c.includes('worktree add')) return '';
      return '';
    });

    const ref = resolveRemoteProject('org/repo');

    expect(ref.name).toBe('repo');
    expect(ref.branch).toBe('main');
    expect(ref.remote).toBe('https://github.com/org/repo.git');
    expect(ref.path).toContain('worktrees-checkout/main');
  });

  it('creates worktree when it does not exist', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('/mock/config/clones/github.com/org/repo')) return true;
      return false;
    });
    mockExecSync.mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes('fetch --all')) return '';
      if (c.includes('symbolic-ref')) return 'refs/heads/main';
      if (c.includes('worktree add')) return '';
      return '';
    });

    resolveRemoteProject('org/repo');

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      expect.objectContaining({ encoding: 'utf-8', stdio: 'pipe' })
    );
  });

  it('uses explicit branch and skips default branch detection', () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('/mock/config/clones/github.com/org/repo')) return true;
      return false;
    });
    mockExecSync.mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes('fetch --all')) return '';
      if (c.includes('worktree add')) return '';
      return '';
    });

    const ref = resolveRemoteProject('org/repo:develop');

    expect(ref.branch).toBe('develop');
    expect(mockExecSync).not.toHaveBeenCalledWith(
      expect.stringContaining('symbolic-ref'),
      expect.anything()
    );
  });
});

describe('pruneClones', () => {
  it('removes directories older than threshold', () => {
    const clonesDir = '/mock/config/clones';
    mockExistsSync.mockImplementation((p) => String(p) === clonesDir);
    mockReaddirSync.mockReturnValue([
      { name: 'old-host', isDirectory: () => true } as never,
      { name: 'new-host', isDirectory: () => true } as never,
    ]);

    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const newDate = new Date();
    mockStatSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('old-host')) return { mtime: oldDate } as never;
      return { mtime: newDate } as never;
    });

    const removed = pruneClones(30);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('old-host');
    expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('old-host'), {
      recursive: true,
      force: true,
    });
    expect(mockRmSync).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when clones dir does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(pruneClones()).toEqual([]);
  });
});
