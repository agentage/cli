import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { hostClient, type HostClient } from '../../lib/daemon/host-client.js';
import { CliError, omitJson } from '../../lib/json-output.js';
import { folderRow } from './install-once.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { execIn, type Exec } from './release-guard.js';
import { assertOwnStack } from './stack-owner.js';
import { removeStage } from './up-build.js';
import { readRecord, stopLocal, type LocalDown, type UpRecord } from './up-local.js';
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

// S1.1.1 D10: an old flag is kept for one minor with a line that names the new form.
export const LOCAL_DEPRECATED =
  '--local is deprecated (removed in the next minor): extension up runs the working copy on the daemon';

type LocalRun = (dir: string | undefined, json: boolean) => Promise<unknown>;

// No Docker: the working copy on the daemon, watched (D12); in CI too. --docker: the kit's path.
export const runExtensionUp = async (
  { docker, local: asked, ...opts }: ExtensionUpFlags = {},
  tool: LoadKitTool = loadKitTool,
  local: LocalRun = (dir, json) => runLocalUp(dir, undefined, json)
): Promise<unknown> => {
  if (docker && asked) throw new CliError('invalid_argument', '--docker and --local: pick one');
  if (!docker) {
    if (asked) console.error(LOCAL_DEPRECATED);
    return local(opts.dir, opts.json === true);
  }
  const { up } = await tool();
  const { lines, onLine } = printed();
  await up({ ...omitJson(opts), onLine });
  return { lines };
};

const dockerDown = async (opts: ExtensionDownOptions, tool: LoadKitTool): Promise<string[]> => {
  const { down } = await tool();
  const { lines, onLine } = printed();
  await down({ ...omitJson(opts), onLine });
  return lines;
};

const LOCAL_LINES: Record<LocalDown, string> = {
  stopped: 'stopped   extension up in this folder',
  stale: 'removed   the record of an extension up that ended',
  none: '',
};

// The row up added goes (no purge: its data stays); a row up found there is left as it was.
const removeAdded = async (dir: string, record: UpRecord | null, host: Host): Promise<string[]> => {
  if (!record?.added) return [];
  const client = await host();
  if (!(await folderRow(client, record.id, dir))) return [];
  await client.remove(record.id, false);
  return [`removed   ${record.id} from the daemon (its data stays)`];
};

type Host = () => Promise<HostClient>;
const defaultHost: Host = async () => hostClient(await ensureDaemon());

// The row up added goes even when that up does not stop or is gone (a stop_failed still throws).
const stopAndRemove = async (dir: string, host: Host, stopMs: number) => {
  const record = readRecord(dir);
  const lines: string[] = [];
  let down: LocalDown = 'none';
  try {
    down = (await stopLocal(dir, stopMs)).down;
    // Only once no up runs: a killed up leaves its stage in the config cache.
    removeStage(dir);
    if (down !== 'none') lines.push(LOCAL_LINES[down]);
  } finally {
    lines.push(...(await removeAdded(dir, record, host)));
    for (const line of lines) console.log(line);
  }
  return { down, lines };
};

// The up of the folder stops and its row goes; a Docker stack up --docker started there goes too.
export const runExtensionDown = async (
  opts: ExtensionDownOptions = {},
  tool: LoadKitTool = loadKitTool,
  host: Host = defaultHost,
  stopMs = 10_000
): Promise<unknown> => {
  const dir = resolve(opts.dir ?? '.');
  const { down, lines } = await stopAndRemove(dir, host, stopMs);
  if (existsSync(join(dir, '.agentage', 'compose.json')))
    lines.push(...(await dockerDown(opts, tool)));
  if (lines.length === 0) {
    lines.push(`nothing runs for ${dir}`);
    console.log(lines[0]);
  }
  return { local: down, lines };
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
