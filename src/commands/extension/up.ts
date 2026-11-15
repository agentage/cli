import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { InvalidArgumentError, type Command } from 'commander';
import { addJson, CliError, omitJson } from '../../lib/json-output.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { execIn, type Exec } from './release-guard.js';
import { assertOwnStack } from './stack-owner.js';
import { stopLocal, type LocalDown } from './up-local.js';
import { runLocalUp } from './up-run.js';

export interface ExtensionUpOptions {
  dir?: string;
  json?: boolean;
}

export interface ExtensionDownOptions extends ExtensionUpOptions {
  keepData?: boolean;
}

export interface ExtensionTokenOptions extends ExtensionUpOptions {
  scope: string;
  issuer?: string;
}

// Prints each line as the kit reports it and keeps them for the --json answer.
const printed = (): { lines: string[]; onLine: (line: string) => void } => {
  const lines: string[] = [];
  return { lines, onLine: (line) => void (console.log(line), lines.push(line)) };
};

export interface ExtensionUpFlags extends ExtensionUpOptions {
  docker?: boolean;
  local?: boolean;
}

export const UP_CHANGED =
  'extension up now runs with no Docker; the Docker stack is `extension up --docker`';

// 0.51's up was Docker: a CI script with neither flag asked for that, so it stops instead.
const noticeChange = ({ local }: ExtensionUpFlags, env: NodeJS.ProcessEnv, tty: boolean) => {
  if (local) return;
  if (env['CI'] && !tty) throw new CliError('invalid_argument', `${UP_CHANGED}; or --local`);
  console.error(UP_CHANGED);
};

type LocalRun = (dir: string | undefined, json: boolean) => Promise<unknown>;

// No Docker: the working copy in this terminal (D7). --docker: the kit's path, a line per step.
export const runExtensionUp = async (
  { docker, local: asked, ...opts }: ExtensionUpFlags = {},
  tool: LoadKitTool = loadKitTool,
  local: LocalRun = (dir, json) => runLocalUp(dir, undefined, json),
  env: NodeJS.ProcessEnv = process.env,
  tty = process.stdin.isTTY === true
): Promise<unknown> => {
  if (docker && asked) throw new CliError('invalid_argument', '--docker and --local: pick one');
  if (!docker) {
    noticeChange({ local: asked }, env, tty);
    return local(opts.dir, opts.json === true);
  }
  const { up } = await tool();
  const { lines, onLine } = printed();
  await up({ ...omitJson(opts), onLine });
  return { lines };
};

const dockerDown = async (opts: ExtensionDownOptions, tool: LoadKitTool, lines: string[]) => {
  const { down } = await tool();
  await down({ ...omitJson(opts), onLine: (line) => void (console.log(line), lines.push(line)) });
};

const LOCAL_LINES: Record<LocalDown, string> = {
  stopped: 'stopped   extension up in this folder',
  stale: 'removed   a stale extension up record (its port no longer answers as it)',
  none: '',
};

// A local up of the folder stops; a Docker stack up --docker started there goes too.
export const runExtensionDown = async (
  opts: ExtensionDownOptions = {},
  tool: LoadKitTool = loadKitTool
): Promise<unknown> => {
  const dir = opts.dir ?? '.';
  const local = await stopLocal(dir);
  const lines = local === 'none' ? [] : [LOCAL_LINES[local]];
  for (const line of lines) console.log(line);
  if (existsSync(join(dir, '.agentage', 'compose.json'))) await dockerDown(opts, tool, lines);
  if (lines.length === 0) {
    lines.push(`nothing runs for ${resolve(dir)}`);
    console.log(lines[0]);
  }
  return { local, lines };
};

// The token alone on stdout, so a script can take it as it is.
export const runExtensionToken = async (
  { dir = '.', json, ...opts }: ExtensionTokenOptions,
  tool: LoadKitTool = loadKitTool,
  exec: Exec = execIn('.', 10)
): Promise<unknown> => {
  if (!opts.issuer) await assertOwnStack(dir, exec, tool);
  const { token } = await tool();
  const value = await token(opts);
  if (json) return { token: value };
  console.log(value);
  return undefined;
};

// A usage error (exit 2) before the kit is asked: the issuer is an http: or https: URL.
export const issuerUrl = (value: string): string => {
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new InvalidArgumentError('not a URL.');
  }
  if (protocol === 'http:' || protocol === 'https:') return value;
  throw new InvalidArgumentError('not an http: or https: URL.');
};

const UP_HELP = `
With no Docker (the default): builds the package in --dir (default: the current folder) as
extension build does, prints what check refuses without stopping, and runs it in this terminal
with the kit host on the first free port from 4244 (127.0.0.1). It prints the URL and runs until
Ctrl-C. It does not use the daemon and does not change installation.json; its store is in
.agentage/data of the folder.

--docker runs the package the way a deployment runs it: the part images built with the release
recipe, the store with its migrations and seeds, a dev token issuer and a local gateway. Each
working copy is its own compose project; up refuses while another one holds localhost:4280 or
4281 and names it. Prints one line per step as the kit reports it. Exits 1 when a step fails.`;

const DOWN_HELP = `
Stops what agentage extension up started for the package in --dir, and nothing else: the local
run of this folder (only when its port still answers as it), and the Docker stack up --docker
started there (its containers, network and the store's volume; --keep-data keeps the volume).
It says so when nothing runs. Exits 1 when that fails.`;

const TOKEN_HELP = `
Prints a token from the dev issuer agentage extension up started for the package in --dir,
alone on stdout, for calling /api/v1/ and /mcp by hand or from tests. Only up trusts it. Exits 1
when the stack on localhost:4281 is not this package's (it names the one that is), or when the
issuer refuses or does not answer within 5 s. --issuer asks that issuer and skips the check.`;

export interface KitActions {
  up: (opts: ExtensionUpFlags) => Promise<void>;
  down: (opts: ExtensionDownOptions) => Promise<void>;
  token: (opts: ExtensionTokenOptions) => Promise<void>;
}

const DIR = '--dir <path>';
const DIR_TEXT = 'the extension package folder (default: the current folder)';

const addUp = (group: Command, up: KitActions['up']): void => {
  addJson(
    group
      .command('up')
      .description('Run the working copy in this terminal until Ctrl-C; --docker = on Docker')
      .option(DIR, DIR_TEXT)
      .option('--docker', 'the images, store, issuer and gateway on Docker')
      .option('--local', 'the run with no Docker, asked for on purpose (no notice; for CI)')
  )
    .addHelpText('after', UP_HELP)
    .action(up);
};

const addDown = (group: Command, down: KitActions['down']): void => {
  addJson(
    group
      .command('down')
      .description('Stop what extension up started here; --keep-data keeps the Docker store')
      .option(DIR, DIR_TEXT)
      .option('--keep-data', "keep the store's volume")
  )
    .addHelpText('after', DOWN_HELP)
    .action(down);
};

const addToken = (group: Command, token: KitActions['token']): void => {
  addJson(
    group
      .command('token')
      .description('Print a token from the dev issuer extension up started')
      .requiredOption('--scope <scope>', 'the scope the token carries, e.g. probe:write')
      .option(DIR, DIR_TEXT)
      .option('--issuer <url>', 'the dev issuer (default: http://localhost:4281)', issuerUrl)
  )
    .addHelpText('after', TOKEN_HELP)
    .action(token);
};

// up, down and token: thin commands over the kit's tool library, for extension authors.
export const addKitTools = (group: Command, actions: KitActions): void => {
  addUp(group, actions.up);
  addDown(group, actions.down);
  addToken(group, actions.token);
};
