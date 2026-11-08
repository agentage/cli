import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Command } from 'commander';
import type { BuildOptions } from '@agentage/extension/tool';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';

export type ExtensionBuildOptions = Pick<BuildOptions, 'push' | 'dir' | 'registry'>;

export type ExtensionCheckOptions = { dir?: string; json?: boolean; write?: boolean };

type WriteContracts = (dir: string) => Promise<string[]>;
export type LoadWriter = () => Promise<Record<string, unknown>>;

// Not in the 0.5.0 types yet: the kit lane adds it in 0.5.1.
const loadWriter: LoadWriter = () => import('@agentage/extension/tool');

// With --json the written paths go to stderr, so stdout stays one JSON document.
const writeContracts = async (dir: string, writer: LoadWriter, json?: boolean): Promise<void> => {
  const write = (await writer())['writeContracts'];
  if (typeof write !== 'function')
    throw new Error('check --write needs @agentage/extension >= 0.5.1');
  for (const file of await (write as WriteContracts)(dir))
    (json ? console.error : console.log)(`wrote ${file}`);
};

// The kit's lines, or its report as JSON, on stdout; a package that does not conform exits 1.
export const runExtensionCheck = async (
  { dir = '.', json, write }: ExtensionCheckOptions = {},
  tool: LoadKitTool = loadKitTool,
  writer: LoadWriter = loadWriter
): Promise<void> => {
  if (write) await writeContracts(dir, writer, json);
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
    .option('--write', 'write the committed contracts (such as {id}.mcpc.json) first, then check')
    .action((dir: string | undefined, opts: { json?: boolean; write?: boolean }) =>
      check({ dir, ...opts })
    );
  group
    .command('build')
    .description('Build the part images of an extension package; --push pushes them')
    .option('--push', 'push the images and write the build record with their digests')
    .option('--dir <path>', 'the extension package folder (default: the current folder)')
    .option('--registry <host/owner>', 'image registry and owner (default: ghcr.io/agentage)')
    .addHelpText('after', BUILD_HELP)
    .action(build);
};
