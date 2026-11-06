import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { runExtensionBuild, runExtensionCheck } from './build.js';
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

const fakeLines: KitTool['checkLines'] = (r) =>
  r.conforms
    ? ['sealing ok', 'PASS probe 0.4.0 conforms (1 rule)']
    : ['sealing: src/api/index.ts:7 reads process.env', 'FAIL 1 problem in 1 rule'];

describe('extension check', () => {
  const report = (conforms: boolean) => ({
    id: 'probe',
    version: '0.4.0',
    conforms,
    rules: ['sealing'],
    problems: conforms
      ? []
      : [{ rule: 'sealing', file: 'src/api/index.ts', line: 7, problem: 'reads process.env' }],
    skipped: {},
  });
  const checking = (conforms: boolean) => {
    const dirs: string[] = [];
    const tool: Partial<KitTool> = {
      check: async (dir) => (dirs.push(dir), report(conforms)),
      checkLines: fakeLines,
    };
    return { tool: async () => tool as KitTool, dirs };
  };
  test('prints the kit lines and PASS; checks the current folder by default', async () => {
    const { tool, dirs } = checking(true);
    const printed = await output(() => runExtensionCheck({}, tool));
    expect(dirs).toEqual(['.']);
    expect(printed.lines).toEqual(['sealing ok', 'PASS probe 0.4.0 conforms (1 rule)']);
    expect(printed.error).toBeNull();
  });

  test('prints each problem, then fails with the FAIL line (exit 1)', async () => {
    const { tool, dirs } = checking(false);
    const printed = await output(() => runExtensionCheck({ dir: 'probe' }, tool));
    expect(dirs).toEqual(['probe']);
    expect(printed.lines).toEqual(['sealing: src/api/index.ts:7 reads process.env']);
    expect(printed.error).toBe('FAIL 1 problem in 1 rule');
  });

  test('--json prints the report: conforms and each problem with rule, file, line', async () => {
    const printed = await output(() => runExtensionCheck({ json: true }, checking(false).tool));
    expect(JSON.parse(printed.lines.join('\n'))).toMatchObject({
      conforms: false,
      problems: [
        { rule: 'sealing', file: 'src/api/index.ts', line: 7, problem: 'reads process.env' },
      ],
    });
    expect(printed.error).toBe('FAIL 1 problem in 1 rule');
  });
});

describe('extension check on the real kit', () => {
  test('runs the kit through the command: a folder without a package.json fails the manifest rule', async () => {
    const printed = await output(() => runExtensionCheck({ dir: join(process.cwd(), 'none') }));
    expect(printed.lines[0]).toMatch(/^manifest: /);
    expect(printed.error).toMatch(/^FAIL \d+ problems? in 1 rule$/);
  });
});
