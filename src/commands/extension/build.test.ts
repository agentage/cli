import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import {
  assertCommitted,
  runExtensionBuild,
  runExtensionCheck,
  runImageBuild,
  type BuildFlagDeps,
} from './build.js';
import { loadKitTool, type KitTool } from './kit-tool.js';

const SHA = 'a'.repeat(40);
const clean = async () => undefined;
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

describe('extension build --push: the part images', () => {
  test('a tree with uncommitted changes exits 1 with "commit first" before the kit runs', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'agentage-build-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
    const { tool, calls } = fakeTool();
    expect((await output(() => runImageBuild({ dir: repo }, tool))).error).toBeNull();
    writeFileSync(join(repo, 'new.ts'), '');
    const printed = await output(() => runImageBuild({ dir: repo }, tool));
    expect(printed.error).toBe(`${repo} has uncommitted changes: commit first`);
    expect(printed.code).toBe('uncommitted_changes');
    expect(calls).toHaveLength(1);
    await expect(assertCommitted(repo)).rejects.toThrow('commit first');
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    await expect(assertCommitted(repo)).rejects.toThrow(
      `${repo} is not a git checkout: commit first`
    );
    rmSync(repo, { recursive: true, force: true });
  });

  test('hands --push, --dir and --registry to the kit tool and prints its lines', async () => {
    const { tool, calls } = fakeTool();
    const printed = await output(() =>
      runImageBuild({ push: true, dir: 'ext', registry: 'localhost:5000/agentage' }, tool, clean)
    );
    expect(calls).toEqual([{ push: true, dir: 'ext', registry: 'localhost:5000/agentage' }]);
    expect(printed.lines).toEqual(['api ghcr.io/agentage/probe-api:0.1.0 pushed']);
    expect(printed.error).toBeNull();
  });

  test('--json returns the kit result and keeps the flag away from the kit', async () => {
    const { tool, calls } = fakeTool();
    const result = await runImageBuild({ dir: '.', push: true, json: true }, tool, clean);
    expect(result).toMatchObject({ id: 'probe', version: '0.1.0', images: [{ part: 'api' }] });
    expect(calls).toEqual([{ dir: '.', push: true }]);
  });

  test('a failed build fails the step with the tool message', async () => {
    const { tool } = fakeTool(new Error('docker build failed with exit code 1'));
    const printed = await output(() => runImageBuild({}, tool, clean));
    expect(printed.error).toBe('docker build failed with exit code 1');
    expect(printed.lines).toEqual([]);
  });

  test("prints the kit's own lines: each image with its short digest, then the record path", async () => {
    const { buildLines } = await loadKitTool();
    const { tool } = fakeTool();
    const kitLines = async () => ({ ...(await tool()), buildLines });
    const printed = await output(() => runImageBuild({ push: true }, kitLines, clean));
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
    expect(printed.code).toBe('not_conforming');
  });

  test('a report that does not conform fails even when the kit gives no lines', async () => {
    const tool = async () => ({ ...(await checking(false).tool()), checkLines: () => [] });
    const printed = await output(() => runExtensionCheck({}, tool));
    expect(printed.lines).toEqual([]);
    expect(printed.error).not.toBeNull();
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

  test('--write writes the contracts through the kit, prints each file, then checks', async () => {
    const { tool: base, dirs } = checking(true);
    const tool = async () => ({
      ...(await base()),
      writeContracts: async (dir: string) => [`${dir}/probe.mcpc.json`],
    });
    const printed = await output(() => runExtensionCheck({ dir: 'probe', write: true }, tool));
    expect(printed.lines).toEqual([
      'wrote probe/probe.mcpc.json',
      'sealing ok',
      'PASS probe 0.4.0 conforms (1 rule)',
    ]);
    expect(dirs).toEqual(['probe']);
  });

  test('--write --json keeps stdout one JSON document: the written paths go to stderr', async () => {
    const tool = async () => ({
      ...(await checking(true).tool()),
      writeContracts: async () => ['probe.mcpc.json'],
    });
    const run = () => runExtensionCheck({ write: true, json: true }, tool);
    const printed = await output(run);
    expect(printed.stderr.trim()).toBe('wrote probe.mcpc.json');
    expect(JSON.parse(printed.lines.join('\n'))).toMatchObject({ conforms: true });
  });
});

describe('extension check on the real kit', () => {
  test('runs the kit through the command: a folder without a package.json fails the manifest rule', async () => {
    const printed = await output(() => runExtensionCheck({ dir: join(process.cwd(), 'none') }));
    expect(printed.lines[0]).toMatch(/^manifest: /);
    expect(printed.error).toMatch(/^FAIL \d+ problems? in 1 rule$/);
  });
});

const conforming = { id: 'demo', version: '0.1.0', rules: [], problems: [], skipped: {} };

const flagDeps = (conforms = true, container = true) => {
  const calls: string[] = [];
  const { tool: images } = fakeTool();
  const deps: BuildFlagDeps = {
    tool: async () => ({ ...(await images()), checkLines: fakeLines }),
    committed: async () => void calls.push('committed'),
    pkg: async (dir) => {
      calls.push(`package ${dir}`);
      const report = { ...conforming, conforms };
      return { dir: dir ?? '.', built: true, contracts: [], report };
    },
    container: async () => container,
  };
  return { deps, calls };
};

describe('extension build: the package, with no Docker', () => {
  test('no flag: the package build, no commit gate, then the check lines', async () => {
    const { deps, calls } = flagDeps();
    const printed = await output(() => runExtensionBuild({ dir: 'demo' }, deps));
    expect(calls).toEqual(['package demo']);
    expect(printed.lines).toEqual(['sealing ok', 'PASS probe 0.4.0 conforms (1 rule)']);
    expect(await runExtensionBuild({ dir: 'demo', json: true }, deps)).toMatchObject({
      dir: 'demo',
      built: true,
      conforms: true,
    });
  });

  test('a package that does not conform exits 1 with the FAIL line', async () => {
    const printed = await output(() => runExtensionBuild({}, flagDeps(false).deps));
    expect(printed).toMatchObject({ code: 'not_conforming', error: 'FAIL 1 problem in 1 rule' });
  });

  test('--container goes to the kit from a committed tree; --registry alone is refused', async () => {
    const { deps, calls } = flagDeps();
    await output(() => runExtensionBuild({ container: true, registry: 'r/o' }, deps));
    expect(calls).toEqual(['committed']);
    const alone = await output(() => runExtensionBuild({ registry: 'r/o' }, deps));
    expect(alone).toMatchObject({ code: 'invalid_argument' });
    expect(alone.error).toContain('--registry names where images go');
  });

  test('--docker: the part images from a committed tree, no push, the flag kept away from the kit', async () => {
    const { tool, calls: kit } = fakeTool();
    const { deps, calls } = flagDeps();
    const run = await output(() =>
      runExtensionBuild({ docker: true, dir: 'ext' }, { ...deps, tool })
    );
    expect(run.error).toBeNull();
    expect(calls).toEqual(['committed']);
    expect(kit).toEqual([{ dir: 'ext' }]);
    const both = await output(() => runExtensionBuild({ docker: true, container: true }, deps));
    expect(both.error).toBe('--container and --docker: pick one');
  });

  test('--container on a kit without the one-image build says so before anything runs', async () => {
    const { deps, calls } = flagDeps(true, false);
    const printed = await output(() => runExtensionBuild({ container: true }, deps));
    expect(printed.code).toBe('invalid_argument');
    expect(printed.error).toMatch(
      /^build --container needs a kit that builds one image \(this cli has @agentage\/extension \d+\.\d+\.\d+/
    );
    expect(calls).toEqual([]);
  });
});
