import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { loadBuildTool, runExtensionBuild, type BuildTool } from './build.js';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

const fakeTool = (fail?: Error) => {
  const calls: unknown[] = [];
  const tool: BuildTool = {
    build: async (options) => {
      calls.push(options);
      if (fail) throw fail;
      return {
        id: 'probe',
        version: '0.1.0',
        commit: SHA,
        buildTime: '2026-11-03T20:00:00Z',
        images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0', digest: DIGEST }],
        recordFile: '/repo/dist/agentage-extension.json',
      };
    },
    buildLines: (result) => result.images.map((image) => `${image.part} ${image.tag} pushed`),
  };
  return { tool: async () => tool, calls };
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

  test('loads build and buildLines from @agentage/extension/tool', async () => {
    const tool = await loadBuildTool();
    expect(typeof tool.build).toBe('function');
    const lines = tool.buildLines({
      id: 'probe',
      version: '0.1.0',
      commit: SHA,
      buildTime: '2026-11-03T20:00:00Z',
      images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0' }],
    });
    expect(lines).toEqual(['api     ghcr.io/agentage/probe-api:0.1.0  built']);
  });

  test('refuses a folder without a valid manifest before touching docker', async () => {
    const tool = await loadBuildTool();
    await expect(tool.build({ dir: '/nonexistent-agentage-extension' })).rejects.toThrow(/ENOENT/);
  });
});
