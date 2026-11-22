import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import {
  CI,
  EXECUTABLE,
  git,
  KIT_MANIFEST,
  kitRepo,
  pushKit,
  put,
  RELEASE,
  TEMPLATE_FILES,
} from '../../test/kit-repo.js';
import { runExtensionCreate, TEMPLATE } from './create.js';

let root = '';
let url = '';
const home = process.cwd();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentage-create-kit-'));
  url = kitRepo(root);
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
  test('the default is the folder template/ of agentage/kit', async () => {
    expect(TEMPLATE).toBe('agentage/kit:template');
    const printed = await create();
    expect(printed).toMatchObject({ error: null, stderr: '' });
    expect(asked.at(-1)).toBe('agentage/kit');
    expect(printed.lines[0]).toBe(' template  agentage/kit:template (default branch, kit 0.21.0)');
  });

  test('only template/ is copied, dot files and modes kept, no kit history', async () => {
    await create();
    expect(listed(made).sort()).toEqual(Object.keys(TEMPLATE_FILES).sort());
    expect(read('.repo-doctor.yml')).toBe('class: extension\n');
    expect(read('.gitignore')).toBe('node_modules/\n');
    expect(read('CLAUDE.md')).toBe('# extension-market\n');
    expect(statSync(join(root, made, EXECUTABLE)).mode & 0o111).toBe(0o111);
    expect(readdirSync(root).filter((f) => f.includes('clone'))).toEqual([]);
  });

  test('repository and bugs name the new repo without the monorepo directory, private stays', async () => {
    expect(KIT_MANIFEST.repository.directory).toBe('template');
    await create();
    const pkg = JSON.parse(read('package.json')) as typeof KIT_MANIFEST;
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/agentage/extension-market.git',
    });
    expect(pkg.bugs.url).toBe('https://github.com/agentage/extension-market/issues');
    expect(pkg.homepage).toBe('https://agentage.io');
    expect(pkg.private).toBe(true);
    expect(read('.github/workflows/release.yml')).toBe(RELEASE);
    expect(read('.github/workflows/ci.yml')).toBe(CI);
  });

  test('--from owner/repo#branch:folder takes that folder of that branch', async () => {
    git(join(root, 'kit-work'), 'checkout', '-q', '-b', 'feature/t');
    put(join(root, 'kit-work', 'other'), { ...TEMPLATE_FILES, 'branch.txt': 'b\n' });
    pushKit(root, 'feature/t');
    const printed = await create('agentage/kit#feature/t:other');
    expect(printed.lines[0]).toMatch(/^ template {2}agentage\/kit:other \(branch feature\/t,/);
    expect(read('branch.txt')).toBe('b\n');
  });

  test.for([
    ['a missing folder', 'agentage/kit:nope'],
    ['a link', 'agentage/kit:link'],
  ])('refuses %s with one line, no folder and no clone left', async ([, from]) => {
    symlinkSync('template', join(root, 'kit-work', 'link'));
    pushKit(root);
    const folder = from?.split(':')[1];
    expect((await create(from)).error).toBe(
      `cannot clone template ${from}: no folder ${folder} in the repo`
    );
    expect(readdirSync(root).sort()).toEqual(['kit-work', 'kit.git']);
  });

  test('a clone that fails leaves no clone folder', async () => {
    const printed = await create(undefined, () => `file://${root}/none`);
    expect(printed.error).toMatch(/^cannot clone template agentage\/kit:template: fatal/);
    expect(existsSync(join(root, made))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(['kit-work', 'kit.git']);
  });
});
