import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { getConfigDir } from '../daemon/config.js';

export interface Project {
  name: string;
  path: string;
  discovered: boolean;
}

export interface Worktree {
  branch: string;
  path: string;
}

export interface ProjectRef {
  name: string;
  path: string;
  branch?: string;
}

const getProjectsPath = (): string => join(getConfigDir(), 'projects.json');

const deriveNameFromDir = (dirPath: string): string => {
  const pkgPath = join(dirPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // fall through to basename
    }
  }
  return basename(dirPath);
};

export const loadProjects = (): Project[] => {
  const path = getProjectsPath();
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
};

export const saveProjects = (projects: Project[]): void => {
  writeFileSync(getProjectsPath(), JSON.stringify(projects, null, 2) + '\n', 'utf-8');
};

export const addProject = (projectPath: string): Project => {
  const absPath = resolve(projectPath);
  const projects = loadProjects();
  const existing = projects.find((p) => p.path === absPath);
  if (existing) return existing;

  const name = deriveNameFromDir(absPath);
  const discovered = false;
  const project: Project = { name, path: absPath, discovered };
  projects.push(project);
  saveProjects(projects);
  return project;
};

export const removeProject = (name: string): boolean => {
  const projects = loadProjects();
  const index = projects.findIndex((p) => p.name === name);
  if (index === -1) return false;

  projects.splice(index, 1);
  saveProjects(projects);
  return true;
};

export const discoverProjects = (rootDir: string): Project[] => {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const projects = loadProjects();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = join(rootDir, entry.name);
    const gitPath = join(dirPath, '.git');

    if (!existsSync(gitPath)) continue;
    if (!statSync(gitPath).isDirectory()) continue;

    if (projects.some((p) => p.path === dirPath)) continue;

    const name = deriveNameFromDir(dirPath);
    projects.push({ name, path: dirPath, discovered: true });
  }

  saveProjects(projects);
  return projects;
};

export const getWorktrees = (projectPath: string): Worktree[] => {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    const blocks = output.trim().split('\n\n');
    const worktrees: Worktree[] = [];

    for (let i = 1; i < blocks.length; i++) {
      const lines = blocks[i].split('\n');
      let path = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length);
        }
        if (line.startsWith('branch refs/heads/')) {
          branch = line.slice('branch refs/heads/'.length);
        }
      }

      if (path && branch) {
        worktrees.push({ branch, path });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
};

export const resolveProject = (
  input: string | undefined,
  projects: Project[],
): ProjectRef => {
  if (input === undefined) {
    const cwd = process.cwd();
    const match = projects.find((p) => cwd.startsWith(p.path));
    if (match) return { name: match.name, path: match.path };
    return { name: basename(cwd), path: cwd };
  }

  if (input.includes(':')) {
    const [name, branch] = input.split(':');
    const project = projects.find((p) => p.name === name);
    if (!project) throw new Error(`Project not found: ${name}`);

    const worktrees = getWorktrees(project.path);
    const worktree = worktrees.find((w) => w.branch === branch);
    if (!worktree) throw new Error(`Worktree not found for branch: ${branch}`);

    return { name: project.name, path: worktree.path, branch };
  }

  if (isAbsolute(input)) {
    return { name: basename(input), path: input };
  }

  const project = projects.find((p) => p.name === input);
  if (!project) throw new Error(`Project not found: ${input}`);
  return { name: project.name, path: project.path };
};
