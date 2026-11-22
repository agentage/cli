/**
 * A scratch git repo for `extension release --changed`: a bare origin, a clone that plays the CI
 * checkout (real git), and gh, docker and npm played by `world`; every non-git call is logged.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest } from '@agentage/extension/tool';
import type { KitTool } from '../commands/extension/kit-tool.js';
import { execIn, type Exec, type Ran } from '../commands/extension/release-guard.js';
import {
  runRelease,
  type ExtensionReleaseOptions,
  type ReleaseDeps,
} from '../commands/extension/release.js';
import { output } from './config-dir.js';

export type Spec = { private?: boolean; api?: boolean };

export const NOW = new Date('2026-11-22T10:00:00Z');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

export const pkgOf = (id: string, spec: Spec = {}) => ({
  name: `@agentage/extension-${id}`,
  version: '0.0.0',
  engines: { agentage: '^0.5' },
  agentage: {
    id,
    parts: spec.api ? { pages: true, api: true, store: 'postgres' } : { pages: true },
  },
  ...(spec.private ? { private: true } : {}),
});

export interface Repo {
  root: string;
  work: string;
  origin: string;
  git: (...args: string[]) => string;
  write: (rel: string, text: string) => void;
  commit: (message: string) => string;
  tag: (name: string) => void;
}

// The source repo: a .gitignore for dist/, as an extension repo has; tags reach origin on push.
export const makeRepo = (): Repo => {
  const root = mkdtempSync(join(tmpdir(), 'agentage-changed-'));
  const work = join(root, 'work');
  const origin = join(root, 'origin.git');
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'master');
  git(root, 'init', '-q', '--bare', '-b', 'master', origin);
  git(work, 'remote', 'add', 'origin', origin);
  const write = (rel: string, text: string) => {
    mkdirSync(join(work, rel, '..'), { recursive: true });
    writeFileSync(join(work, rel), text);
  };
  write('.gitignore', 'dist/\n');
  const commit = (message: string) => {
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
    git(work, 'push', '-q', 'origin', 'master', '--tags');
    return git(work, 'rev-parse', 'HEAD');
  };
  const tag = (name: string) => {
    git(work, 'tag', name);
    git(work, 'push', '-q', 'origin', '--tags');
  };
  return { root, work, origin, git: (...a) => git(work, ...a), write, commit, tag };
};

export const writeExtension = (repo: Repo, rel: string, id: string, spec: Spec = {}) => {
  repo.write(join(rel, 'package.json'), `${JSON.stringify(pkgOf(id, spec), null, 2)}\n`);
  repo.write(join(rel, 'index.js'), `export const id = '${id}';\n`);
};

// A full checkout of an older commit, as a re-run of that commit's workflow run has.
export const checkoutAt = (repo: Repo, sha: string): string => {
  const dir = join(repo.root, `at-${sha.slice(0, 7)}`);
  execFileSync('git', ['clone', '-q', `file://${repo.origin}`, dir]);
  execFileSync('git', ['checkout', '-q', sha], { cwd: dir });
  return dir;
};

// The CI checkout: a depth-1 clone with no tags, as actions/checkout makes by default.
export const ciClone = (repo: Repo): string => {
  const dir = join(repo.root, `ci-${Math.random().toString(36).slice(2)}`);
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repo.origin}`, dir]);
  return dir;
};

export interface World {
  records?: Record<string, string>;
  refAt?: string;
  refFails?: string;
  downloadFails?: string;
  npmFails?: string;
}

const ran = (ok: boolean, text = ''): Ran =>
  ok ? { ok, out: text, err: '' } : { ok, out: '', err: text };

const gh = (w: World, args: string[]): Ran => {
  const call = args.join(' ');
  if (call.startsWith('release download') && w.downloadFails) return ran(false, w.downloadFails);
  if (call.startsWith('release download')) {
    const commit = w.records?.[args[2] ?? ''];
    return commit ? ran(true, JSON.stringify({ commit })) : ran(false, 'release not found');
  }
  if (call.startsWith('release view')) return ran(false, 'release not found');
  if (args[0] === 'api' && args.includes('--jq')) return ran(true, `${w.refAt ?? ''}\n`);
  if (args[0] === 'api' && w.refFails) return ran(false, w.refFails);
  return ran(true);
};

const npm = (w: World, args: string[]): Ran => {
  if (args[0] === '--version') return ran(true, '11.7.0\n');
  if (args[0] === 'view') return ran(false, 'E404');
  return w.npmFails ? ran(false, w.npmFails) : ran(true);
};

// Real git in the folder it runs in; gh, docker and npm from the world.
export const changedDeps = (w: World, calls: string[], env: NodeJS.ProcessEnv) => {
  const exec =
    (cwd: string): Exec =>
    async (cmd, args, extra) => {
      if (cmd === 'git') return execIn(cwd)(cmd, args, extra);
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'gh') return gh(w, args);
      if (cmd === 'npm') return npm(w, args);
      return ran(false, 'manifest unknown');
    };
  return { exec, tool: async () => kitStub(calls), env, now: () => NOW } satisfies ReleaseDeps;
};

const kitStub = (calls: string[]): KitTool => {
  const tool: Partial<KitTool> = {
    readManifest,
    build: async (opts) => {
      const dir = opts?.dir ?? '.';
      rmSync(join(dir, 'dist'), { recursive: true, force: true });
      mkdirSync(join(dir, 'dist'), { recursive: true });
      const name = opts?.container ? 'agentage-container.json' : 'agentage-extension.json';
      writeFileSync(join(dir, 'dist', name), '{}');
      const pkg = await readManifest(dir);
      calls.push(`build ${pkg.agentage.id}@${pkg.version}${opts?.container ? ' container' : ''}`);
      return { id: pkg.agentage.id, version: pkg.version, commit: '', buildTime: '', images: [] };
    },
    buildLines: () => [],
    writeContracts: async (dir) => {
      writeFileSync(join(dir, 'openapi.json'), '{"info":{"version":"new"}}\n');
      calls.push('writeContracts');
      return ['openapi.json'];
    },
  };
  return tool as KitTool;
};

export const REPO = 'agentage/examples';

type Run = { dir: string; w?: World; opts?: ExtensionReleaseOptions; env?: NodeJS.ProcessEnv };

// One --changed run in `dir`: its printed lines, error, result and every non-git call.
export const release = async ({ dir, w = {}, opts = {}, env }: Run, tool?: Partial<KitTool>) => {
  const calls: string[] = [];
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const deps = changedDeps(w, calls, env ?? { GITHUB_REPOSITORY: REPO, GITHUB_SHA: sha });
  const kit = tool ? { tool: async () => ({ ...(await deps.tool()), ...tool }) as KitTool } : {};
  let result: unknown;
  const printed = await output(async () => {
    result = await runRelease({ dir, changed: true, ...opts }, { ...deps, ...kit });
  });
  return { ...printed, result, calls, sha };
};
