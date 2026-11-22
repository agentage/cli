import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The template's manifest as the kit holds it: create rewrites the word template in repository and bugs.
export const KIT_MANIFEST = {
  name: '@agentage/extension-template',
  private: true,
  repository: {
    type: 'git',
    url: 'git+https://github.com/agentage/extension-template.git',
    directory: 'template',
  },
  homepage: 'https://agentage.io',
  bugs: { url: 'https://github.com/agentage/extension-template/issues' },
  dependencies: { '@agentage/extension': '^0.21.0' },
  agentage: { id: 'template', parts: { api: true } },
};
export const RELEASE =
  'on:\n  push:\n    branches: [master]\n# run: npx -y @agentage/cli@0.71.0 extension release --changed\n';
export const CI = "jobs:\n  verify:\n  ci-required:\n    env:\n      MIN_EXECUTED: '25'\n";
export const EXECUTABLE = 'scripts/run.sh';
export const TEMPLATE_FILES = {
  'package.json': JSON.stringify(KIT_MANIFEST, null, 2),
  'CLAUDE.md': '# extension-template\n',
  '.gitignore': 'node_modules/\n',
  '.repo-doctor.yml': 'class: extension\n',
  '.github/workflows/ci.yml': CI,
  '.github/workflows/release.yml': RELEASE,
  'src/api/index.ts': "export const create = () => 'api';\n",
  [EXECUTABLE]: '#!/bin/sh\necho run\n',
};
// The kit's own files beside template/: none of them may reach the new folder.
const KIT_FILES = {
  'package.json': '{ "name": "kit-root", "workspaces": ["packages/*"] }\n',
  'CLAUDE.md': '# the kit\n',
  '.repo-doctor.yml': 'class: kit\n',
  '.github/workflows/release.yml': 'name: kit release\n',
  'packages/extension/package.json': '{ "name": "@agentage/extension" }\n',
};

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd }).toString();

export const put = (dir: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
    if (path.endsWith('.sh')) chmodSync(join(dir, path), 0o755);
  }
};

// A bare repo shaped like the kit under root, served over file://; work is its working copy.
export const kitRepo = (root: string): string => {
  const work = join(root, 'kit-work');
  put(work, KIT_FILES);
  put(join(work, 'template'), TEMPLATE_FILES);
  git(root, 'init', '-q', '-b', 'master', work);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'kit');
  git(root, 'clone', '-q', '--bare', work, join(root, 'kit.git'));
  return `file://${join(root, 'kit.git')}`;
};

// Commits what changed in the working copy and pushes that branch to the bare repo.
export const pushKit = (root: string, branch = 'master'): void => {
  const work = join(root, 'kit-work');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'change');
  git(work, 'push', '-q', join(root, 'kit.git'), branch);
};
