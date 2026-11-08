import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitVersion } from '../../core/kit-version.js';
import { satisfies } from '../../core/semver-range.js';
import { fixture } from '../../test/config-dir.js';
import { kitCheck, loadKitTool, type KitTool } from './kit-tool.js';

const USED = [
  'check',
  'checkLines',
  'build',
  'buildLines',
  'runCommand',
  'checkCli',
  'up',
  'down',
  'token',
] as const;
// Every runtime entry of the kit's exports map (schemas/* and package.json are data).
const ENTRIES = [
  '@agentage/extension',
  '@agentage/extension/tool',
  '@agentage/extension/contracts',
  '@agentage/extension/migrate',
];

describe('the kit fixtures', () => {
  it.each(['probe', 'pong'])('%s ranges over the kit installed here', (name) => {
    const pkg = JSON.parse(readFileSync(join(fixture(name), 'package.json'), 'utf8')) as {
      engines: { agentage: string };
    };
    expect(satisfies(kitVersion(), pkg.engines.agentage)).toBe(true);
  });
});

describe('the kit tool library', () => {
  it('is imported on use: the program loads no kit entry until loadKitTool, then has every export', async () => {
    vi.resetModules();
    const loads: string[] = [];
    for (const entry of ENTRIES)
      vi.doMock(entry, async (actual) => {
        loads.push(entry);
        return actual();
      });
    await import('../../program.js');
    expect(loads).toEqual([]);
    const tool = await (await import('./kit-tool.js')).loadKitTool();
    expect(loads).toEqual(['@agentage/extension/tool']);
    for (const name of USED) expect(typeof tool[name], name).toBe('function');
    for (const entry of ENTRIES) vi.doUnmock(entry);
  });

  it("the kit's checkCli finds probe's create and its ping handler", async () => {
    const { checkCli } = await loadKitTool();
    expect(await checkCli(fixture('probe'))).toBeNull();
    expect(await checkCli(fixture('pong'))).toBeNull();
    expect(await checkCli(fixture('hello'))).toMatch(
      /^invalid agentage manifest in package\.json: /
    );
  });

  it('the kit runs probe ping with its args: pong hi, exit 0; too many args, exit 2', async () => {
    const { runCommand } = await loadKitTool();
    const out: string[] = [];
    const err: string[] = [];
    const run = (argv: string[]) =>
      runCommand({
        dir: fixture('probe'),
        command: 'ping',
        argv,
        stdout: (text) => void out.push(text),
        stderr: (text) => void err.push(text),
      });
    expect(await run(['hi'])).toBe(0);
    expect(await run(['a', 'b'])).toBe(2);
    expect(out.join('')).toBe('pong hi\n');
    expect(err.join('')).toBe('too many arguments: b\n');
  });

  it("checks a kit-built extension's folder through the kit's checkCli", async () => {
    const asked: string[] = [];
    const checkCli = async (dir: string) => {
      asked.push(dir);
      return dir === '/bad' ? 'no create' : null;
    };
    const check = kitCheck(async () => ({ checkCli }) as unknown as KitTool);
    expect(await check('/good')).toBeNull();
    expect(await check('/bad')).toBe('no create');
    expect(asked).toEqual(['/good', '/bad']);
  });
});
