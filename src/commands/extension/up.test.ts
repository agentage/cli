import { down, readManifest } from '@agentage/extension/tool';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { type KitTool } from './kit-tool.js';
import { type Exec } from './release-guard.js';
import { ownProject } from './stack-owner.js';
import { issuerUrl, runExtensionDown, runExtensionToken, runExtensionUp } from './up.js';

// The kit tool as a seam: what each call got, the lines it reports, or the error it throws.
const fakeKit = (fail?: Error) => {
  const calls: [string, unknown][] = [];
  const step = async (name: string, options: Record<string, unknown>, lines: string[]) => {
    calls.push([name, { ...options, onLine: typeof options['onLine'] }]);
    if (fail) throw fail;
    for (const line of lines) (options['onLine'] as (line: string) => void)(line);
  };
  const tool: Partial<KitTool> = {
    readManifest,
    up: async (options) => {
      await step('up', { ...options }, ['store    postgres:18-alpine', 'ready    7 parts healthy']);
      return { parts: 7, seconds: 48, project: 'agentage-probe-ab1613a3' };
    },
    down: async (options) => {
      await step('down', { ...options }, ['removed  6 containers']);
      return { project: 'agentage-probe-ab1613a3', containers: 6, networks: 1, volumes: 1 };
    },
    token: async (options) => {
      calls.push(['token', options]);
      if (fail) throw fail;
      return 'eyJhbGciOi.dev.token';
    },
  };
  return { tool: async () => tool as KitTool, calls };
};

// docker as a seam: the row publishing 4281 first (null for none, '' for no compose label), then another.
const holding = (project: string | null, ok = true) => {
  const asked: string[][] = [];
  const exec: Exec = async (_cmd, args) => {
    asked.push(args);
    const own = project === null ? '' : `${project}\t127.0.0.1:4281->3000/tcp\n`;
    const rows = `${own}other\t0.0.0.0:5432->5432/tcp\n`;
    return { ok, out: rows, err: ok ? '' : 'Cannot connect to the Docker daemon' };
  };
  return { exec, asked };
};

const MANIFEST = {
  name: '@agentage/extension-market',
  version: '0.1.0',
  engines: { agentage: '>=0.12.0' },
  agentage: { id: 'market', parts: { api: true } },
};

// The project the kit's own `down` picks for a folder; docker is a seam that removes nothing.
const kitProject = async (folder: string): Promise<string> =>
  (await down({ dir: folder }, async () => ({ code: 0, stdout: '', stderr: '' }))).project;

// market ran up; copy is market copied with cp -r; legacy and fresh never rendered their own.
const folders = (dir: {
  write: (path: string, value: unknown) => void;
  at: (p: string) => string;
}) => {
  for (const name of ['market', 'copy', 'legacy', 'fresh'])
    dir.write(`${name}/package.json`, MANIFEST);
  return async () => {
    const own = await kitProject(dir.at('market'));
    dir.write('market/.agentage/compose.json', { name: own });
    dir.write('copy/.agentage/compose.json', { name: own });
    dir.write('legacy/.agentage/compose.json', { name: 'agentage-market' });
    return own;
  };
};

const HERE = 'not this folder: run agentage extension up here';
const PROBE = 'agentage-probe-ab1613a3';

describe('extension up, down and token: thin commands over the kit tool', () => {
  test('up hands --dir to the kit and prints each line as it comes', async () => {
    const { tool, calls } = fakeKit();
    const run = await output(() => runExtensionUp({ dir: 'probe' }, tool));
    expect(calls).toEqual([['up', { dir: 'probe', onLine: 'function' }]]);
    expect(run.lines).toEqual(['store    postgres:18-alpine', 'ready    7 parts healthy']);
  });

  test('down hands --dir and --keep-data to the kit and prints its lines', async () => {
    const { tool, calls } = fakeKit();
    const run = await output(() => runExtensionDown({ keepData: true }, tool));
    expect(calls).toEqual([['down', { keepData: true, onLine: 'function' }]]);
    expect(run.lines).toEqual(['removed  6 containers']);
  });

  test.for([
    ['the stack up is the one up started here', 'market', 'own'],
    ['a legacy project is up and compose.json here names it', 'legacy', 'agentage-market'],
  ])('token prints the token alone on stdout when %s', async ([, folder, held], { dir }) => {
    const own = await folders(dir)();
    const { tool, calls } = fakeKit();
    const { exec, asked } = holding(held === 'own' ? own : (held ?? ''));
    const run = await output(() =>
      runExtensionToken({ scope: 'market:write', dir: dir.at(folder ?? '') }, tool, exec)
    );
    expect(asked[0]?.slice(0, 2)).toEqual(['ps', '--format']);
    expect(calls).toEqual([['token', { scope: 'market:write' }]]);
    expect(run.stdout).toBe('eyJhbGciOi.dev.token');
  });

  test("the folder's own project is the one the kit's down picks, a copied compose.json ignored", async ({
    dir,
  }) => {
    const own = await folders(dir)();
    expect(own).toBe(await ownProject('market', dir.at('market')));
    expect(await kitProject(dir.at('copy'))).toBe(await ownProject('market', dir.at('copy')));
    expect(await kitProject(dir.at('copy'))).not.toBe(own);
    expect(await kitProject(dir.at('legacy'))).toBe('agentage-market');
  });

  test.for([
    [
      'another extension is up',
      'market',
      PROBE,
      `the stack up is extension probe (${PROBE}), ${HERE}`,
    ],
    [
      'a legacy project is up',
      'market',
      'agentage-market',
      `the stack up is compose project agentage-market, ${HERE}`,
    ],
    ['this folder was never up', 'fresh', 'own', `the stack up is extension market (own), ${HERE}`],
    [
      'the folder is a copy of the one up',
      'copy',
      'own',
      `the stack up is extension market (own), ${HERE}`,
    ],
    [
      'nothing is up',
      'market',
      null,
      'no stack is up on localhost:4281: run agentage extension up here',
    ],
    [
      'a container not from compose holds 4281',
      'market',
      '',
      'localhost:4281 is held by a container that is not from compose: stop it, then run agentage extension up here',
    ],
  ] as const)(
    'token refuses when %s, before asking the issuer',
    async ([, folder, held, error], { dir }) => {
      const own = await folders(dir)();
      const { tool, calls } = fakeKit();
      const opts = { scope: 'market:read', dir: dir.at(folder) };
      const run = await output(() =>
        runExtensionToken(opts, tool, holding(held === 'own' ? own : held).exec)
      );
      expect(run).toMatchObject({ error: error.replace('(own)', `(${own})`), stdout: '' });
      expect(calls).toEqual([]);
    }
  );

  test('token says so when docker cannot tell which stack is up', async () => {
    const { tool } = fakeKit();
    const run = await output(() =>
      runExtensionToken({ scope: 'm:read' }, tool, holding(null, false).exec)
    );
    expect(run.error).toBe(
      'cannot ask docker which stack is up: Cannot connect to the Docker daemon'
    );
  });

  test('token with --issuer asks that issuer and skips the local stack check', async () => {
    const { tool, calls } = fakeKit();
    const { exec, asked } = holding(null);
    const opts = { scope: 'probe:write', issuer: 'http://localhost:4281' };
    expect((await output(() => runExtensionToken(opts, tool, exec))).stdout).toBe(
      'eyJhbGciOi.dev.token'
    );
    expect([asked, calls]).toEqual([[], [['token', opts]]]);
  });

  test('a failing step fails the command with the kit message', async () => {
    const { tool } = fakeKit(new Error('docker is not running'));
    for (const step of [
      () => runExtensionUp({}, tool),
      () => runExtensionDown({}, tool),
      () => runExtensionToken({ scope: 'probe:write', issuer: 'http://localhost:4281' }, tool),
    ])
      expect(await output(step)).toMatchObject({ error: 'docker is not running', lines: [] });
  });

  test('--issuer is an http: or https: URL, else a usage error', () => {
    expect(issuerUrl('http://localhost:4281')).toBe('http://localhost:4281');
    expect(issuerUrl('https://issuer.example')).toBe('https://issuer.example');
    expect(() => issuerUrl('localhost:4281')).toThrow('not an http: or https: URL.');
    expect(() => issuerUrl('nope')).toThrow('not a URL.');
  });
});
