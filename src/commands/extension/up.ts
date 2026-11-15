import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CliError, omitJson } from '../../lib/json-output.js';
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

// CI=false, 0 or empty is not CI.
const inCi = (env: NodeJS.ProcessEnv): boolean =>
  !['', 'false', '0', undefined].includes(env['CI']);

// 0.51's up was Docker: a CI script with neither flag asked for that, so it stops instead.
const noticeChange = ({ local }: ExtensionUpFlags, env: NodeJS.ProcessEnv, tty: boolean) => {
  if (local) return;
  if (inCi(env) && !tty) throw new CliError('invalid_argument', `${UP_CHANGED}; or --local`);
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

const dockerDown = async (opts: ExtensionDownOptions, tool: LoadKitTool): Promise<string[]> => {
  const { down } = await tool();
  const { lines, onLine } = printed();
  await down({ ...omitJson(opts), onLine });
  return lines;
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
  if (existsSync(join(dir, '.agentage', 'compose.json')))
    lines.push(...(await dockerDown(opts, tool)));
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
