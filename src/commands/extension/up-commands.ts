import { InvalidArgumentError, type Command } from 'commander';
import { addJson } from '../../lib/json-output.js';
import {
  type ExtensionDownOptions,
  type ExtensionTokenOptions,
  type ExtensionUpFlags,
} from './up.js';

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
