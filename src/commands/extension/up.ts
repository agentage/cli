import { InvalidArgumentError, type Command } from 'commander';
import { addJson } from '../../lib/json-output.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { execIn, type Exec } from './release-guard.js';
import { assertOwnStack } from './stack-owner.js';

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

// Each step's line as the kit reports it, the ready line last.
export const runExtensionUp = async (
  { json: _json, ...opts }: ExtensionUpOptions = {},
  tool: LoadKitTool = loadKitTool
): Promise<unknown> => {
  const { up } = await tool();
  const { lines, onLine } = printed();
  await up({ ...opts, onLine });
  return { lines };
};

export const runExtensionDown = async (
  { json: _json, ...opts }: ExtensionDownOptions = {},
  tool: LoadKitTool = loadKitTool
): Promise<unknown> => {
  const { down } = await tool();
  const { lines, onLine } = printed();
  await down({ ...opts, onLine });
  return { lines };
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
Runs the extension package in --dir (default: the current folder) on this machine with Docker
only, the way a deployment runs it: the part images built with the release recipe, the store
with its migrations and seeds, a dev token issuer and a local gateway. Each working copy is its
own compose project; up refuses while another one holds localhost:4280 or 4281 and names it, and
on a kept store says what was already applied. Prints one line per step as the kit reports it,
the last one once every part is healthy. Needs docker; every docker call has a timeout. Exits 1
when a step fails, with the kit's message.`;

const DOWN_HELP = `
Removes what agentage extension up started for the package in --dir, and nothing else: its
containers, network and the store's volume; --keep-data keeps the volume. The line it prints
names the compose project it removed. Exits 1 when that fails.`;

const TOKEN_HELP = `
Prints a token from the dev issuer agentage extension up started for the package in --dir,
alone on stdout, for calling /api/v1/ and /mcp by hand or from tests. Only up trusts it. Exits 1
when the stack on localhost:4281 is not this package's (it names the one that is), or when the
issuer refuses or does not answer within 5 s. --issuer asks that issuer and skips the check.`;

export interface KitActions {
  up: (opts: ExtensionUpOptions) => Promise<void>;
  down: (opts: ExtensionDownOptions) => Promise<void>;
  token: (opts: ExtensionTokenOptions) => Promise<void>;
}

const DIR = '--dir <path>';
const DIR_TEXT = 'the extension package folder (default: the current folder)';

const addUp = (group: Command, up: KitActions['up']): void => {
  addJson(
    group
      .command('up')
      .description('Run the extension package on this machine: images, store, issuer, gateway')
      .option(DIR, DIR_TEXT)
  )
    .addHelpText('after', UP_HELP)
    .action(up);
};

const addDown = (group: Command, down: KitActions['down']): void => {
  addJson(
    group
      .command('down')
      .description('Remove what extension up started; --keep-data keeps the store')
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
