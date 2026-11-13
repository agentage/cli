import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { type KitTool } from './kit-tool.js';
import { type Exec } from './release-guard.js';
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

// docker as a seam: another container, then the one publishing 4281 ('' for none).
const holding = (project: string, ok = true) => {
  const asked: string[][] = [];
  const exec: Exec = async (_cmd, args) => {
    asked.push(args);
    const rows = `other\t0.0.0.0:5432->5432/tcp\n${project ? `${project}\t127.0.0.1:4281->3000/tcp\n` : ''}`;
    return { ok, out: rows, err: ok ? '' : 'Cannot connect to the Docker daemon' };
  };
  return { exec, asked };
};

const OWN = 'agentage-market-0a1b2c3d';
const HERE = 'not this folder: run agentage extension up here';
const OTHER = `the stack up is extension probe (agentage-probe-ab1613a3), ${HERE}`;

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

  test("token prints the token alone on stdout when the stack up is this folder's", async ({
    dir,
  }) => {
    dir.write('market/.agentage/compose.json', { name: OWN });
    const { tool, calls } = fakeKit();
    const { exec, asked } = holding(OWN);
    const run = await output(() =>
      runExtensionToken({ scope: 'market:write', dir: dir.at('market') }, tool, exec)
    );
    expect(asked[0]?.slice(0, 2)).toEqual(['ps', '--format']);
    expect(calls).toEqual([['token', { scope: 'market:write' }]]);
    expect(run.stdout).toBe('eyJhbGciOi.dev.token');
  });

  test.for([
    ['another extension is up', 'market', 'agentage-probe-ab1613a3', OTHER],
    [
      'a legacy project is up',
      'market',
      'agentage-probe',
      `the stack up is compose project agentage-probe, ${HERE}`,
    ],
    [
      'this folder was never up',
      'fresh',
      OWN,
      `the stack up is extension market (${OWN}), ${HERE}`,
    ],
    [
      'nothing is up',
      'market',
      '',
      'no stack is up on localhost:4281: run agentage extension up here',
    ],
  ])(
    'token refuses when %s, before asking the issuer',
    async ([, folder, holder, error], { dir }) => {
      dir.write('market/.agentage/compose.json', { name: OWN });
      dir.write('fresh/package.json', '{}');
      const { tool, calls } = fakeKit();
      const opts = { scope: 'market:read', dir: dir.at(folder ?? '') };
      const run = await output(() => runExtensionToken(opts, tool, holding(holder ?? '').exec));
      expect(run).toMatchObject({ error, stdout: '' });
      expect(calls).toEqual([]);
    }
  );

  test('token says so when docker cannot tell which stack is up', async () => {
    const { tool } = fakeKit();
    const run = await output(() =>
      runExtensionToken({ scope: 'm:read' }, tool, holding('', false).exec)
    );
    expect(run.error).toBe(
      'cannot ask docker which stack is up: Cannot connect to the Docker daemon'
    );
  });

  test('token with --issuer asks that issuer and skips the local stack check', async () => {
    const { tool, calls } = fakeKit();
    const { exec, asked } = holding('');
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
