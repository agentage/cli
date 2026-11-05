import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { type KitTool } from './kit-tool.js';
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
      return { parts: 7, seconds: 48 };
    },
    down: async (options) => {
      await step('down', { ...options }, ['removed  6 containers']);
      return { containers: 6, networks: 1, volumes: 1 };
    },
    token: async (options) => {
      calls.push(['token', options]);
      if (fail) throw fail;
      return 'eyJhbGciOi.dev.token';
    },
  };
  return { tool: async () => tool as KitTool, calls };
};

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

  test('token prints the token alone on stdout', async () => {
    const { tool, calls } = fakeKit();
    const opts = { scope: 'probe:write', issuer: 'http://localhost:4281' };
    const run = await output(() => runExtensionToken(opts, tool));
    expect(calls).toEqual([['token', opts]]);
    expect(run.stdout).toBe('eyJhbGciOi.dev.token');
  });

  test('a failing step fails the command with the kit message', async () => {
    const { tool } = fakeKit(new Error('docker is not running'));
    for (const step of [
      () => runExtensionUp({}, tool),
      () => runExtensionDown({}, tool),
      () => runExtensionToken({ scope: 'probe:write' }, tool),
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
