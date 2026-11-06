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
  const shown = json
    ? [JSON.stringify(report, null, 2)]
    : lines.slice(0, report.conforms ? undefined : -1);
  for (const line of shown) console.log(line);
  if (!report.conforms) throw new Error(lines.at(-1));
};

// One line per image on stdout (part, tag, digest when pushed), then the record path.
export const runExtensionBuild = async (
  opts: ExtensionBuildOptions = {},
  tool: LoadKitTool = loadKitTool
): Promise<void> => {
  const { build, buildLines } = await tool();
  for (const line of buildLines(await build(opts))) console.log(line);
};

const BUILD_HELP = `
Builds one image per server part of the extension package in --dir (default: the current
folder): the manifest is checked, the package's own build script runs, then the kit recipe makes
each image, tagged ghcr.io/agentage/<id>-<part>:<version> with the commit and build time as
labels. --push pushes them (run docker login first) and writes dist/agentage-extension.json, the
build record with every image by digest. Needs docker. Exits 1 when the manifest is invalid or a
build or push fails.`;

const CHECK_HELP = `
Runs the kit's six rules (manifest, entries, surface, stack, store, sealing) on the package in
[dir], as every build does before an image; the store rule is skipped without docker. Exits 1
when the package does not conform.`;

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
    .addHelpText('after', CHECK_HELP)
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
