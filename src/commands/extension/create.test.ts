import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { PARTS, runExtensionCreate } from './create.js';

const CODE_PARTS = ['pages', 'ui', 'api', 'mcp', 'worker', 'cli'];
const MANIFEST = {
  name: '@agentage/extension-template',
  version: '0.1.0',
  dependencies: { '@agentage/extension': '^0.5.0' },
  agentage: {
    id: 'template',
    parts: {
      pages: true,
      ui: true,
      api: true,
      mcp: true,
      worker: true,
      cli: true,
      store: 'postgres',
    },
    commands: [{ name: 'ping', summary: 'answer pong' }],
    settings: { 'mcp.listing': { type: 'string', default: 'open' } },
  },
};

const LOCK = {
  name: '@agentage/extension-template',
  packages: {
    '': { name: '@agentage/extension-template' },
    'node_modules/@babel/template': { version: '7.27.2' },
  },
};

// A repo shaped like the template manifest of sheet C2, committed, cloned over file://.
const templateRepo = (root: string): string => {
  const repo = join(root, 'extension-template-src');
  const put = (path: string, text: string | Buffer) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  put('package.json', JSON.stringify(MANIFEST, null, 2));
  for (const part of CODE_PARTS) {
    put(`src/${part}/index.ts`, `export const create = () => '${part}';\n`);
    put(`src/${part}/index.test.ts`, `// ${part} test\n`);
  }
  put('migrations/001-ping.sql', 'select 1;\n');
  put('seeds/001-hello.sql', 'select 1;\n');
  put('template.mcpc.json', '{ "name": "agentage-template", "tool": "template__echo" }\n');
  put('openapi.json', '{ "title": "template", "pat": ["template:read"] }\n');
  put('CLAUDE.md', '# extension-template\nhost `template.next.agentage.io`, templates stay\n');
  put('package-lock.json', JSON.stringify(LOCK, null, 2));
  put('.github/workflows/ci.yml', "        env:\n          MIN_EXECUTED: '25'\n");
  put('logo.png', Buffer.from([0, 116, 101, 109, 112, 108, 97, 116, 101]));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'master');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'template');
  return `file://${repo}`;
};

let root = '';
let url = '';
const home = process.cwd();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentage-create-'));
  url = templateRepo(root);
  process.chdir(root);
});
afterEach(() => {
  process.chdir(home);
  rmSync(root, { recursive: true, force: true });
});

const create = (id: string, parts: string[] = [], from?: string) =>
  output(() => runExtensionCreate({ id, parts, from }, () => url));
const read = (path: string) => readFileSync(join(root, 'extension-market', path), 'utf8');
const manifest = () => JSON.parse(read('package.json')) as typeof MANIFEST;

describe('extension create', () => {
  test('keeps the named parts only: their folders, tests and manifest keys', async () => {
    const printed = await create('market', ['mcp', 'api']);
    expect(printed.error).toBeNull();
    expect(printed.lines).toEqual([
      ' template  agentage/extension-template (default branch, kit 0.5.0)',
      ' kept      mcp, api',
      ' id        market  ·  host market.next.agentage.io  ·  contract market.mcpc.json',
      ' next      cd extension-market && npm ci && npm run build && agentage extension check',
      " ci        MIN_EXECUTED is 1: after the first green run, set it to the gate's count",
    ]);
    expect(read('.github/workflows/ci.yml')).toContain("MIN_EXECUTED: '1'\n");
    const { agentage } = manifest();
    expect(agentage.parts).toEqual({ api: true, mcp: true });
    expect(agentage).not.toHaveProperty('commands');
    expect(agentage.settings).toEqual(MANIFEST.agentage.settings);
    for (const part of CODE_PARTS)
      expect(existsSync(join(root, 'extension-market/src', part, 'index.test.ts'))).toBe(
        ['mcp', 'api'].includes(part)
      );
    for (const dir of ['migrations', 'seeds', '.git'])
      expect(existsSync(join(root, 'extension-market', dir))).toBe(false);
  });

  test('no parts keeps all seven, the store with its migrations and seeds', async () => {
    const printed = await create('market');
    expect(printed.lines[1]).toBe(` kept      ${PARTS.join(', ')}`);
    expect(printed.lines).toHaveLength(4);
    expect(read('.github/workflows/ci.yml')).toContain("MIN_EXECUTED: '25'\n");
    expect(manifest().agentage.parts).toEqual(MANIFEST.agentage.parts);
    expect(manifest().agentage.commands).toEqual(MANIFEST.agentage.commands);
    expect(read('migrations/001-ping.sql')).toBe('select 1;\n');
    expect(read('seeds/001-hello.sql')).toBe('select 1;\n');
  });

  test.each([
    [['mcp'], [false, true]],
    [['api'], [true, false]],
  ])('a contract file goes with its dropped part: keep %j', async (parts, [api, mcp]) => {
    await create('market', parts);
    const has = (file: string) => existsSync(join(root, 'extension-market', file));
    expect([has('openapi.json'), has('market.mcpc.json'), has('template.mcpc.json')]).toEqual([
      api,
      mcp,
      false,
    ]);
  });

  test('dropping mcp drops its listing setting', async () => {
    await create('market', ['api']);
    expect(manifest().agentage.settings).toEqual({});
  });

  test('rewrites the id, package name, host and contract file name from template', async () => {
    const printed = await create('market', ['mcp', 'api'], 'someone/their-template');
    expect(printed.lines[0]).toBe(' template  someone/their-template (default branch, kit 0.5.0)');
    expect(manifest()).toMatchObject({
      name: '@agentage/extension-market',
      agentage: { id: 'market' },
    });
    expect(read('market.mcpc.json')).toContain('"agentage-market", "tool": "market__echo"');
    expect(existsSync(join(root, 'extension-market/template.mcpc.json'))).toBe(false);
    expect(read('openapi.json')).toBe('{ "title": "market", "pat": ["market:read"] }\n');
    expect(read('CLAUDE.md')).toBe(
      '# extension-market\nhost `market.next.agentage.io`, templates stay\n'
    );
    expect(readFileSync(join(root, 'extension-market/logo.png')).subarray(1).toString()).toBe(
      'template'
    );
  });

  test('the lock keeps its template packages and takes the new name', async () => {
    await create('market', ['api']);
    const lock = JSON.parse(read('package-lock.json')) as typeof LOCK;
    expect(lock.name).toBe('@agentage/extension-market');
    expect(lock.packages['']).toEqual({ name: '@agentage/extension-market' });
    expect(lock.packages).toHaveProperty(['node_modules/@babel/template']);
  });

  test('a template repo that is not there fails with its name, no folder left', async () => {
    const printed = await output(() =>
      runExtensionCreate({ id: 'market', parts: [], from: 'x/none' }, () => `file://${root}/none`)
    );
    expect(printed.error).toMatch(/^cannot clone template x\/none: fatal: .*none/);
    expect(existsSync(join(root, 'extension-market'))).toBe(false);
  });

  test('a clone that fails after it made the folder leaves no folder', async () => {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'git'),
      '#!/bin/sh\nfor a; do last=$a; done\nmkdir -p "$last"\nexit 1\n',
      {
        mode: 0o755,
      }
    );
    const path = process.env['PATH'];
    process.env['PATH'] = `${bin}:${path ?? ''}`;
    try {
      expect((await create('market')).error).toMatch(/^cannot clone template /);
    } finally {
      process.env['PATH'] = path;
    }
    expect(existsSync(join(root, 'extension-market'))).toBe(false);
  });

  test('a clone that is not a template fails with one line and leaves no folder, so a re-run works', async () => {
    rmSync(join(url.slice('file://'.length), 'package.json'));
    execFileSync('git', ['-C', url.slice('file://'.length), 'commit', '-qam', 'x'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
    const { error } = await create('market');
    expect(existsSync(join(root, 'extension-market'))).toBe(false);
    expect(error).toMatch(/^template agentage\/extension-template: ENOENT/);
  });

  test.each([
    ['market', ['mcp', 'db'], 'unknown part db: one of pages, ui, api, mcp, worker, store, cli'],
    ['api', ['api'], 'id api is a part name: pick another id'],
    ['../x', [], 'id ../x: lowercase letters, digits and -, starting with a letter'],
    ['m$&', [], 'id m$&: lowercase letters, digits and -, starting with a letter'],
    ['market', ['cli'], 'an extension needs at least one of pages, ui, api, mcp'],
    ['market', ['store'], 'an extension needs at least one of pages, ui, api, mcp'],
    ['market', ['cli', 'store'], 'an extension needs at least one of pages, ui, api, mcp'],
  ])('refuses %s %j before cloning', async (id, parts, message) => {
    expect((await create(id, parts)).error).toBe(message);
    expect(existsSync(join(root, `extension-${id}`))).toBe(false);
  });

  test('refuses a --from that is not owner/repo', async () => {
    expect((await create('market', [], '../../x')).error).toBe('--from ../../x: owner/repo');
  });

  test('refuses an existing folder and leaves it as it was', async () => {
    mkdirSync(join(root, 'extension-market'));
    writeFileSync(join(root, 'extension-market', 'mine.txt'), 'mine');
    expect((await create('market')).error).toBe(
      'extension-market exists: pick another id or remove it'
    );
    expect(read('mine.txt')).toBe('mine');
  });
});
