import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Command } from 'commander';
import type { BuildOptions } from '@agentage/extension/tool';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';

export type ExtensionBuildOptions = Pick<BuildOptions, 'push' | 'dir' | 'registry'>;

export type ExtensionCheckOptions = { dir?: string; json?: boolean };

// The kit's lines, or its report as JSON, on stdout; a package that does not conform exits 1.
export const runExtensionCheck = async (
  { dir = '.', json }: ExtensionCheckOptions = {},
  tool: LoadKitTool = loadKitTool
): Promise<void> => {
  const { check, checkLines } = await tool();
  const report = await check(dir);
  const lines = checkLines(report);
  const fail = report.conforms ? undefined : lines.pop();
  for (const line of json ? [JSON.stringify(report, null, 2)] : lines) console.log(line);
  if (!report.conforms) throw new Error(fail);
};

export type Committed = (dir: string) => Promise<void>;

// The build record names HEAD, so the tree it builds must be HEAD.
export const assertCommitted: Committed = async (dir) => {
  const status = promisify(execFile)('git', ['status', '--porcelain'], { cwd: dir });
  const { stdout } = await status.catch(() => {
    throw new Error(`${dir} is not a git checkout: commit first`);
  });
  if (stdout.trim()) throw new Error(`${dir} has uncommitted changes: commit first`);
};

// One line per image on stdout (part, tag, digest when pushed), then the record path.
export const runExtensionBuild = async (
  opts: ExtensionBuildOptions = {},
  tool: LoadKitTool = loadKitTool,
  committed: Committed = assertCommitted
): Promise<void> => {
  await committed(opts.dir ?? '.');
  const { build, buildLines } = await tool();
  for (const line of buildLines(await build(opts))) console.log(line);
};

const BUILD_HELP = `
Builds one image per server part of the extension package in --dir (default: the current
folder): the package's own build script runs, then extension check, then the kit recipe makes
each image, tagged ghcr.io/agentage/<id>-<part>:<version> with the commit and build time as
labels. --push pushes them (run docker login first) and writes dist/agentage-extension.json, the
build record with every image by digest. Needs docker. Exits 1 when the package does not conform or
a build or push fails.`;

export interface BuildActions {
  check: (opts: ExtensionCheckOptions) => Promise<void>;
  build: (opts: ExtensionBuildOptions) => Promise<void>;
}

export const addBuild = (group: Command, { check, build }: BuildActions): void => {
  group
    .command('check')
    .description('Check that an extension package conforms, as every build does first')
    .argument('[dir]', 'the extension package folder (default: the current folder)')
    .option('--json', 'machine-readable report')
    .action((dir: string | undefined, opts: { json?: boolean }) => check({ dir, ...opts }));
  group
    .command('build')
    .description('Build the part images of an extension package; --push pushes them')
    .option('--push', 'push the images and write the build record with their digests')
    .option('--dir <path>', 'the extension package folder (default: the current folder)')
    .option('--registry <host/owner>', 'image registry and owner (default: ghcr.io/agentage)')
    .addHelpText('after', BUILD_HELP)
    .action(build);
};
