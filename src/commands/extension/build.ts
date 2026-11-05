import { type Command } from 'commander';
import { type BuildOptions } from '@agentage/extension/tool';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';

export type ExtensionBuildOptions = Pick<BuildOptions, 'push' | 'dir' | 'registry'>;

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

export const addBuild = (
  group: Command,
  build: (opts: ExtensionBuildOptions) => Promise<void>
): void => {
  group
    .command('build')
    .description('Build the part images of an extension package; --push pushes them')
    .option('--push', 'push the images and write the build record with their digests')
    .option('--dir <path>', 'the extension package folder (default: the current folder)')
    .option('--registry <host/owner>', 'image registry and owner (default: ghcr.io/agentage)')
    .addHelpText('after', BUILD_HELP)
    .action(build);
};
