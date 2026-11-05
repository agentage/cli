import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { runExtensionBuild } from './build.js';
import { loadKitTool, type KitTool } from './kit-tool.js';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

const fakeTool = (fail?: Error) => {
  const calls: unknown[] = [];
  const tool: Partial<KitTool> = {
    build: async (options) => {
      calls.push(options);
      if (fail) throw fail;
      return {
        id: 'probe',
        version: '0.1.0',
        commit: SHA,
        buildTime: '2026-11-03T20:00:00Z',
        images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0', digest: DIGEST }],
        recordFile: join(process.cwd(), 'dist', 'agentage-extension.json'),
      };
    },
    buildLines: (result) => result.images.map((image) => `${image.part} ${image.tag} pushed`),
  };
  return { tool: async () => tool as KitTool, calls };
};

describe('extension build', () => {
  test('hands --push, --dir and --registry to the kit tool and prints its lines', async () => {
    const { tool, calls } = fakeTool();
    const printed = await output(() =>
      runExtensionBuild({ push: true, dir: 'ext', registry: 'localhost:5000/agentage' }, tool)
    );
    expect(calls).toEqual([{ push: true, dir: 'ext', registry: 'localhost:5000/agentage' }]);
    expect(printed.lines).toEqual(['api ghcr.io/agentage/probe-api:0.1.0 pushed']);
    expect(printed.error).toBeNull();
  });

  test('a failed build fails the step with the tool message', async () => {
    const { tool } = fakeTool(new Error('docker build failed with exit code 1'));
    const printed = await output(() => runExtensionBuild({}, tool));
    expect(printed.error).toBe('docker build failed with exit code 1');
    expect(printed.lines).toEqual([]);
  });

  test("prints the kit's own lines: each image with its short digest, then the record path", async () => {
    const { buildLines } = await loadKitTool();
    const { tool } = fakeTool();
    const kitLines = async () => ({ ...(await tool()), buildLines });
    const printed = await output(() => runExtensionBuild({ push: true }, kitLines));
    expect(printed.lines).toEqual([
      'api     ghcr.io/agentage/probe-api:0.1.0  sha256:bbbbbbbb pushed',
      'record  dist/agentage-extension.json',
    ]);
  });
});
