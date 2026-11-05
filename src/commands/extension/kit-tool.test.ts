import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { kitVersion } from '../../core/kit-version.js';
import { fixture } from '../../test/config-dir.js';
import { kitCheck, loadKitTool, type KitTool } from './kit-tool.js';

describe('the kit tool library', () => {
  it('is imported on use from @agentage/extension/tool, with every export the cli uses', async () => {
    const tool = await loadKitTool();
    const names = ['build', 'buildLines', 'runCommand', 'checkCli', 'up', 'down', 'token'] as const;
    for (const name of names) expect(typeof tool[name], name).toBe('function');
  });

  it('KIT_VERSION is the version the static gate reads from the kit package.json', async () => {
    const { KIT_VERSION } = await import('@agentage/extension/tool');
    const path = createRequire(import.meta.url).resolve('@agentage/extension/package.json');
    const { version } = JSON.parse(readFileSync(path, 'utf-8')) as { version: string };
    expect(KIT_VERSION).toBe(version);
    expect(kitVersion()).toBe(KIT_VERSION);
  });

  it("the kit's checkCli finds probe's create and its ping handler", async () => {
    const { checkCli } = await loadKitTool();
    expect(await checkCli(fixture('probe'))).toBeNull();
    expect(await checkCli(fixture('pong'))).toBeNull();
    expect(await checkCli(fixture('hello'))).toMatch(/invalid agentage manifest/);
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
    expect(out.join('')).toBe('pong hi\n');
    expect(await run(['a', 'b'])).toBe(2);
    expect(err.join('')).toContain('too many arguments: b');
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
