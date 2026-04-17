import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { getConfigDir } from '../daemon/config.js';

export interface Project {
  name: string;
  path: string;
  discovered: boolean;
  /** Git remote origin URL (if the project is a git repo with an origin). */
  remote?: string;
}

export interface Worktree {
  branch: string;
  path: string;
}

export interface ProjectRef {
  name: string;
  path: string;
  branch?: string;
  remote?: string;
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

const isValidProject = (value: unknown): value is Project => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.discovered === 'boolean' &&
    (candidate.remote === undefined || typeof candidate.remote === 'string')
  );
};

/** Reads the origin remote URL of a git repo. Returns undefined if not a repo or no origin. */
const getOriginUrl = (projectPath: string): string | undefined => {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
};

export const loadProjects = (): Project[] => {
  const path = getProjectsPath();
  if (!existsSync(path)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    // Unreadable / malformed JSON — rewrite with a clean empty array.
    saveProjects([]);
    return [];
  }

  // Foreign schema (e.g. agentage desktop's `{$version, projects}` format) —
  // rewrite with our schema so subsequent operations work.
  if (!Array.isArray(parsed) || !parsed.every(isValidProject)) {
    saveProjects([]);
    return [];
  }

  // Self-heal: drop entries whose path no longer exists (hub infers removal
  // from absence in heartbeat), and backfill missing remotes.
  const healed: Project[] = [];
  let changed = false;
  for (const project of parsed) {
    if (!existsSync(project.path)) {
      changed = true;
      continue;
    }
    if (!project.remote) {
      const remote = getOriginUrl(project.path);
      if (remote) {
        healed.push({ ...project, remote });
        changed = true;
        continue;
      }
    }
    healed.push(project);
  }
  if (changed) saveProjects(healed);
  return healed;
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
  const remote = getOriginUrl(absPath);
  const project: Project = { name, path: absPath, discovered: false, ...(remote && { remote }) };
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

export const PROJECTS_IGNORE_DIRS = new Set([
  'node_modules',
  '.github',
  '.github-private',
  '.claude',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
]);

const MAX_DISCOVERY_DEPTH = 5;

const walkForGitRepos = (dir: string, depth: number, out: string[]): void => {
  if (depth > MAX_DISCOVERY_DEPTH) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (PROJECTS_IGNORE_DIRS.has(entry.name)) continue;

    const dirPath = join(dir, entry.name);
    const gitPath = join(dirPath, '.git');

    let isRepo = false;
    try {
      isRepo = existsSync(gitPath) && statSync(gitPath).isDirectory();
    } catch {
      isRepo = false;
    }

    if (isRepo) {
      out.push(dirPath);
      // Don't descend into a matched repo — we treat it as the project boundary.
      continue;
    }

    walkForGitRepos(dirPath, depth + 1, out);
  }
};

export const discoverProjects = (rootDirs: string | string[]): Project[] => {
  const roots = Array.isArray(rootDirs) ? rootDirs : [rootDirs];
  const found: string[] = [];
  for (const root of roots) {
    walkForGitRepos(root, 0, found);
  }

  const projects = loadProjects();
  const seen = new Set(projects.map((p) => p.path));

  for (const dirPath of found) {
    const existing = projects.find((p) => p.path === dirPath);
    if (existing) {
      if (!existing.remote) {
        const remote = getOriginUrl(dirPath);
        if (remote) existing.remote = remote;
      }
      continue;
    }
    if (seen.has(dirPath)) continue;
    seen.add(dirPath);

    const name = deriveNameFromDir(dirPath);
    const remote = getOriginUrl(dirPath);
    projects.push({ name, path: dirPath, discovered: true, ...(remote && { remote }) });
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

const HTTPS_GIT_RE = /^https:\/\/.+\/.+/;
const SSH_GIT_RE = /^git@[^:]+:.+/;
const SHORTHAND_RE = /^[^./][^/\s]*\/[^/\s]+$/;

export const isGitUrl = (input: string): boolean => {
  if (HTTPS_GIT_RE.test(input)) return true;
  if (SSH_GIT_RE.test(input)) return true;
  const base = input.split(':')[0].split('#')[0];
  return SHORTHAND_RE.test(base);
};

export const normalizeGitUrl = (input: string): { url: string; branch?: string } => {
  if (SSH_GIT_RE.test(input)) {
    const hashIdx = input.indexOf('#');
    if (hashIdx !== -1) {
      return { url: input.slice(0, hashIdx), branch: input.slice(hashIdx + 1) };
    }
    return { url: input };
  }

  if (HTTPS_GIT_RE.test(input)) {
    return parseHttpsBranch(input);
  }

  return parseShorthand(input);
};

const parseHttpsBranch = (input: string): { url: string; branch?: string } => {
  const domainEnd = input.indexOf('/', 8);
  const afterDomain = domainEnd !== -1 ? input.slice(domainEnd) : '';
  const colonIdx = afterDomain.lastIndexOf(':');
  if (colonIdx !== -1) {
    const url = input.slice(0, domainEnd + colonIdx);
    const branch = afterDomain.slice(colonIdx + 1);
    return { url, branch };
  }
  return { url: input };
};

const parseShorthand = (input: string): { url: string; branch?: string } => {
  const colonIdx = input.indexOf(':');
  if (colonIdx !== -1) {
    const repo = input.slice(0, colonIdx);
    const branch = input.slice(colonIdx + 1);
    return { url: `https://github.com/${repo}.git`, branch };
  }
  return { url: `https://github.com/${input}.git` };
};

export const getClonesDir = (): string => join(getConfigDir(), 'clones');

export const getClonePath = (url: string): string => {
  const cleaned = url.replace(/\.git$/, '');
  if (cleaned.startsWith('git@')) {
    const afterAt = cleaned.slice(4);
    const parts = afterAt.replace(':', '/');
    return join(getClonesDir(), parts);
  }
  const withoutProtocol = cleaned.replace(/^https?:\/\//, '');
  return join(getClonesDir(), withoutProtocol);
};

const execGit = (cmd: string, cwd?: string): string =>
  execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', cwd }).trim();

export const cloneOrFetch = (url: string): string => {
  const clonePath = getClonePath(url);
  if (existsSync(clonePath)) {
    execGit('git fetch --all --prune', clonePath);
  } else {
    mkdirSync(clonePath, { recursive: true });
    execGit(`git clone --bare ${url} ${clonePath}`);
  }
  return clonePath;
};

const detectDefaultBranch = (barePath: string): string => {
  const ref = execGit('git symbolic-ref HEAD', barePath);
  return ref.replace('refs/heads/', '');
};

const deriveNameFromUrl = (url: string): string => {
  const last = url.split('/').pop() ?? '';
  return last.replace(/\.git$/, '');
};

export const resolveRemoteProject = (input: string): ProjectRef => {
  const { url, branch: inputBranch } = normalizeGitUrl(input);
  const barePath = cloneOrFetch(url);
  const branch = inputBranch ?? detectDefaultBranch(barePath);
  const worktreePath = join(barePath, 'worktrees-checkout', branch.replace(/\//g, '-'));

  if (!existsSync(worktreePath)) {
    execGit(`git worktree add ${worktreePath} ${branch}`, barePath);
  }

  const name = deriveNameFromUrl(url);
  return { name, path: worktreePath, branch, remote: url };
};

export const pruneClones = (maxAgeDays = 30): string[] => {
  const clonesDir = getClonesDir();
  if (!existsSync(clonesDir)) return [];

  const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  const entries = readdirSync(clonesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(clonesDir, entry.name);
    const { mtime } = statSync(fullPath);
    if (mtime.getTime() < threshold) {
      rmSync(fullPath, { recursive: true, force: true });
      removed.push(fullPath);
    }
  }

  return removed;
};

export const resolveProject = (input: string | undefined, projects: Project[]): ProjectRef => {
  if (input === undefined) {
    const cwd = process.cwd();
    const match = projects.find((p) => cwd.startsWith(p.path));
    if (match) return { name: match.name, path: match.path };
    return { name: basename(cwd), path: cwd };
  }

  if (isGitUrl(input)) {
    return resolveRemoteProject(input);
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
