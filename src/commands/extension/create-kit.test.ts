import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { runExtensionCreate, TEMPLATE } from './create.js';

// The template's manifest as the kit holds it: create rewrites the word template in repository and bugs.
const MANIFEST = {
  name: '@agentage/extension-template',
  private: true,
  repository: { type: 'git', url: 'git+https://github.com/agentage/extension-template.git' },
  homepage: 'https://agentage.io',
  bugs: { url: 'https://github.com/agentage/extension-template/issues' },
  dependencies: { '@agentage/extension': '^0.21.0' },
  agentage: { id: 'template', parts: { api: true } },
};
const RELEASE =
  'on:\n  push:\n    branches: [master]\n# run: npx -y @agentage/cli@0.71.0 extension release --changed\n';
const CI = "jobs:\n  verify:\n  ci-required:\n    env:\n      MIN_EXECUTED: '25'\n";
const TEMPLATE_FILES = {
  'package.json': JSON.stringify(MANIFEST, null, 2),
  'CLAUDE.md': '# extension-template\n',
  '.gitignore': 'node_modules/\n',
  '.repo-doctor.yml': 'class: extension\n',
  '.github/workflows/ci.yml': CI,
  '.github/workflows/release.yml': RELEASE,
  'src/api/index.ts': "export const create = () => 'api';\n",
};
// The kit's own files beside template/: none of them may reach the new folder.
const KIT_FILES = {
  'package.json': '{ "name": "@agentage/platform", "workspaces": ["packages/*"] }\n',
  'CLAUDE.md': '# the kit\n',
  '.repo-doctor.yml': 'class: kit\n',
  '.github/workflows/release.yml': 'name: kit release\n',
  'packages/extension/package.json': '{ "name": "@agentage/extension" }\n',
};

let root = '';
let url = '';
const home = process.cwd();
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd }).toString();
const put = (dir: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};

// A bare repo shaped like the kit, served over file://.
const kitRepo = (): string => {
  const work = join(root, 'kit-work');
  put(work, KIT_FILES);
  put(join(work, 'template'), TEMPLATE_FILES);
  git(root, 'init', '-q', '-b', 'master', work);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'kit');
  git(root, 'clone', '-q', '--bare', work, join(root, 'kit.git'));
  return `file://${join(root, 'kit.git')}`;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentage-create-kit-'));
  url = kitRepo();
  process.chdir(root);
});
afterEach(() => {
  process.chdir(home);
  rmSync(root, { recursive: true, force: true });
});

const YES = { isTTY: true, prompt: async () => 'y' };
const scaffoldOnly = async () => ({ installed: null, url: null });
const asked: string[] = [];
const create = (from?: string, to = () => url) =>
  output(() =>
    runExtensionCreate(
      { id: 'market', parts: [], ...(from && { from }) },
      (repo) => (asked.push(repo), to()),
      scaffoldOnly,
      YES
    )
  );
const made = 'extension-market';
const read = (path: string) => readFileSync(join(root, made, path), 'utf8');
const listed = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listed(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]
  );

describe('extension create from the kit repo', () => {
  test('the default is the folder template/ of agentage/platform', async () => {
    expect(TEMPLATE).toBe('agentage/platform:template');
    const printed = await create();
    expect(printed).toMatchObject({ error: null, stderr: '' });
    expect(asked.at(-1)).toBe('agentage/platform');
    expect(printed.lines[0]).toBe(
      ' template  agentage/platform:template (default branch, kit 0.21.0)'
    );
  });

  test('only template/ is copied, dot files and dot folders included, no kit history', async () => {
    await create();
    expect(listed(made).sort()).toEqual(Object.keys(TEMPLATE_FILES).sort());
    expect(read('.repo-doctor.yml')).toBe('class: extension\n');
    expect(read('CLAUDE.md')).toBe('# extension-market\n');
    expect(readdirSync(root).filter((f) => f.includes('clone'))).toEqual([]);
  });

  test('repository and bugs name the new repo, private stays, the workflows are the template ones', async () => {
    await create();
    const pkg = JSON.parse(read('package.json')) as typeof MANIFEST;
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/agentage/extension-market.git',
    });
    expect(pkg.bugs.url).toBe('https://github.com/agentage/extension-market/issues');
    expect(pkg.homepage).toBe('https://agentage.io');
    expect(pkg.repository).not.toHaveProperty('directory');
    expect(pkg.private).toBe(true);
    expect(read('.github/workflows/release.yml')).toBe(RELEASE);
    expect(read('.github/workflows/ci.yml')).toBe(CI);
  });

  test('--from owner/repo#branch:folder takes that folder of that branch', async () => {
    const work = join(root, 'kit-work');
    git(work, 'checkout', '-q', '-b', 'feature/t');
    put(join(work, 'other'), { ...TEMPLATE_FILES, 'branch.txt': 'b\n' });
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'b');
    git(work, 'push', '-q', join(root, 'kit.git'), 'feature/t');
    const printed = await create('agentage/platform#feature/t:other');
    expect(printed.lines[0]).toMatch(/^ template {2}agentage\/platform:other \(branch feature\/t,/);
    expect(read('branch.txt')).toBe('b\n');
  });

  test.for([
    ['a missing folder', 'agentage/platform:nope'],
    ['a link', 'agentage/platform:link'],
  ])('refuses %s with one line, no folder and no clone left', async ([, from]) => {
    const work = join(root, 'kit-work');
    symlinkSync('template', join(work, 'link'));
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'link');
    git(work, 'push', '-q', join(root, 'kit.git'), 'master');
    const folder = from?.split(':')[1];
    expect((await create(from)).error).toBe(
      `cannot clone template ${from}: no folder ${folder} in the repo`
    );
    expect(readdirSync(root).sort()).toEqual(['kit-work', 'kit.git']);
  });

  test('a clone that fails leaves no clone folder', async () => {
    const printed = await create(undefined, () => `file://${root}/none`);
    expect(printed.error).toMatch(/^cannot clone template agentage\/platform:template: fatal/);
    expect(existsSync(join(root, made))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(['kit-work', 'kit.git']);
  });
});
