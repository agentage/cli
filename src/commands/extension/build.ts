import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Command } from 'commander';
import type { BuildOptions } from '@agentage/extension/tool';
import { addJson, CliError, omitJson } from '../../lib/json-output.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { buildPackage, newerKitLine, type PackageBuild } from './package-build.js';

export type ExtensionBuildOptions = Pick<
  BuildOptions,
  'push' | 'dir' | 'registry' | 'container'
> & {
  // The part images on this machine, as --push builds them, without the push.
  docker?: boolean;
  json?: boolean;
};

export type ExtensionCheckOptions = { dir?: string; json?: boolean; write?: boolean };

// With --json the written paths go to stderr, so stdout stays one JSON document.
const writeContracts = async (dir: string, tool: LoadKitTool, json?: boolean): Promise<void> => {
  for (const file of await (await tool()).writeContracts(dir))
    (json ? console.error : console.log)(`wrote ${file}`);
};

// The kit's lines, or its report as JSON, on stdout; a package that does not conform exits 1.
export const runExtensionCheck = async (
  { dir = '.', json, write }: ExtensionCheckOptions = {},
  tool: LoadKitTool = loadKitTool
): Promise<void> => {
  if (write) await writeContracts(dir, tool, json);
  const { check, checkLines } = await tool();
  const report = await check(dir);
  const lines = checkLines(report);
  const fail = report.conforms ? undefined : lines.pop();
  for (const line of json ? [JSON.stringify(report, null, 2)] : lines) console.log(line);
  if (report.conforms) return;
  const newer = newerKitLine(dir);
  throw new CliError(
    'not_conforming',
    [fail ?? 'does not conform', newer].filter(Boolean).join('; ')
  );
};

export type Committed = (dir: string) => Promise<void>;

// The build record names HEAD, so the tree it builds must be HEAD.
export const assertCommitted: Committed = async (dir) => {
  const status = promisify(execFile)('git', ['status', '--porcelain'], {
    cwd: dir,
    timeout: 30_000,
  });
  const { stdout } = await status.catch(() => {
    throw new Error(`${dir} is not a git checkout: commit first`);
  });
  if (stdout.trim())
    throw new CliError('uncommitted_changes', `${dir} has uncommitted changes: commit first`);
};

// The images of the kit recipe, from a committed tree: --push (the release path) or --container.
export const runImageBuild = async (
  opts: ExtensionBuildOptions = {},
  tool: LoadKitTool = loadKitTool,
  committed: Committed = assertCommitted
): Promise<unknown> => {
  await committed(opts.dir ?? '.');
  const { build, buildLines } = await tool();
  const kit = omitJson(opts);
  delete kit.docker;
  const result = await build(kit as Parameters<typeof build>[0]);
  for (const line of buildLines(result)) console.log(line);
  return result;
};

export interface BuildFlagDeps {
  tool: LoadKitTool;
  committed: Committed;
  pkg: (dir?: string) => Promise<PackageBuild>;
}

const defaultFlagDeps: BuildFlagDeps = {
  tool: loadKitTool,
  committed: assertCommitted,
  pkg: (dir) => buildPackage(dir),
};

const refusedFlags = (opts: ExtensionBuildOptions): string => {
  if (opts.container && opts.docker) return '--container and --docker: pick one';
  if (opts.registry && !opts.push && !opts.container && !opts.docker)
    return '--registry names where images go: use it with --docker, --container or --push';
  return '';
};

// The package with no Docker: the build script, the contracts, then check; it must conform.
const packageOnly = async (dir: string | undefined, deps: BuildFlagDeps): Promise<unknown> => {
  const { report, ...done } = await deps.pkg(dir);
  const lines = (await deps.tool()).checkLines(report);
  const fail = report.conforms ? undefined : lines.pop();
  for (const line of lines) console.log(line);
  if (!report.conforms) throw new CliError('not_conforming', fail ?? 'does not conform');
  return { ...done, conforms: true };
};

// No flag: the package. --docker: the part images; --container: one image; --push: pushed, with the record.
export const runExtensionBuild = async (
  opts: ExtensionBuildOptions = {},
  deps: BuildFlagDeps = defaultFlagDeps
): Promise<unknown> => {
  const refused = refusedFlags(opts);
  if (refused) throw new CliError('invalid_argument', refused);
  if (!opts.push && !opts.container && !opts.docker) return packageOnly(opts.dir, deps);
  return runImageBuild(opts, deps.tool, deps.committed);
};

const BUILD_HELP = `
With no flag, builds the package in --dir (default: the current folder) with no Docker: its own
build script, then the contract files the kit writes (such as {id}.mcpc.json), then extension
check. Any folder state works, committed or not. Exits 1 when a step fails or the package does
not conform.

--container builds one image of the extension, ghcr.io/agentage/<id>:<version>, with the kit's
recipe (node:26-alpine, the kit host as its command). --docker builds one
image per server part on this machine. --push builds those, pushes them (run docker login first)
and writes dist/agentage-extension.json, the build record with every image by digest; with
--container it pushes the one image. Each needs docker and a committed tree.`;

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
  addJson(
    group
      .command('build')
      .description('Build the extension package; --container = one image, all parts')
      .option('--docker', 'one image per server part on this machine (needs docker)')
      .option('--container', 'one image of the extension (needs docker)')
      .option('--push', 'build and push the images, write the build record with their digests')
      .option('--dir <path>', 'the extension package folder (default: the current folder)')
      .option('--registry <host/owner>', 'image registry and owner (default: ghcr.io/agentage)')
  )
    .addHelpText('after', BUILD_HELP)
    .action(build);
};
