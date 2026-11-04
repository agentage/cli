import { describe, expect, it } from 'vitest';
import { kitCheck, loadKitTool, type KitTool } from './kit-tool.js';

describe('the kit tool library', () => {
  it('is imported on use from @agentage/extension/tool', async () => {
    const tool = await loadKitTool();
    expect(typeof tool.runCommand).toBe('function');
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
