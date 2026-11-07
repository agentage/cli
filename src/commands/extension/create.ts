import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Command } from 'commander';

const run = promisify(execFile);
export const TEMPLATE = 'agentage/extension-template';
export const PARTS = ['pages', 'ui', 'api', 'mcp', 'worker', 'store', 'cli'];
// `_` is a separator here, so `template__echo` is the id too.
const WORD = /(?<![A-Za-z0-9])template(?![A-Za-z0-9])/g;

export interface ExtensionCreateOptions {
  id: string;
  parts: string[];
  from?: string;
}

export type RepoUrl = (from: string) => string;
const github: RepoUrl = (from) => `https://github.com/${from}`;

interface Manifest {
  dependencies?: Record<string, string>;
  agentage: {
    parts?: Record<string, unknown>;
    commands?: unknown;
    settings?: Record<string, unknown>;
  };
}

const refusal = ({ id, parts }: ExtensionCreateOptions): string | undefined => {
  const unknown = parts.find((part) => !PARTS.includes(part));
  if (unknown) return `unknown part ${unknown}: one of ${PARTS.join(', ')}`;
  if (PARTS.includes(id)) return `id ${id} is a part name: pick another id`;
  return existsSync(`extension-${id}`)
    ? `extension-${id} exists: pick another id or remove it`
    : undefined;
};

// Every word `template` in a text file or a file name is the id: package name, host, contract.
const rewrite = (dir: string, id: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewrite(path, id);
    const text = entry.isFile() ? readFileSync(path, 'utf8') : '\0';
    if (!text.includes('\0')) writeFileSync(path, text.replace(WORD, id));
    const name = entry.name.replace(WORD, id);
    if (name !== entry.name) renameSync(path, join(dir, name));
  }
};

// A dropped part goes with its folder (its tests beside it), its manifest keys and the store's SQL.
const drop = (dir: string, kept: string[]): string => {
  const file = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  const { parts = {}, settings = {} } = pkg.agentage;
  for (const part of PARTS.filter((part) => !kept.includes(part))) {
    delete parts[part];
    rmSync(join(dir, 'src', part), { recursive: true, force: true });
  }
  if (!kept.includes('cli')) delete pkg.agentage.commands;
  if (!kept.includes('mcp')) delete settings['mcp.listing'];
  if (!kept.includes('store'))
    for (const sql of ['migrations', 'seeds'])
      rmSync(join(dir, sql), { recursive: true, force: true });
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg.dependencies?.['@agentage/extension'] ?? 'unknown';
};

const lines = (opts: ExtensionCreateOptions, from: string, kit: string, kept: string[]) => [
  ` template  ${from} (default branch, kit ${kit.replace(/^[\^~]/, '')})`,
  ` kept      ${kept.join(', ')}`,
  ` id        ${opts.id}  ·  host ${opts.id}.next.agentage.io  ·  contract ${opts.id}.mcpc.json`,
  ` next      cd extension-${opts.id} && npm ci && npm run build && agentage extension check`,
];

// Clones the template's default branch into ./extension-<id> as a new working copy, no history.
export const runExtensionCreate = async (
  opts: ExtensionCreateOptions,
  url: RepoUrl = github
): Promise<void> => {
  const refused = refusal(opts);
  if (refused) throw new Error(refused);
  const { id, from = TEMPLATE } = opts;
  const dir = `extension-${id}`;
  const kept = opts.parts.length > 0 ? [...new Set(opts.parts)] : PARTS;
  await run('git', ['clone', '-q', '--depth', '1', url(from), dir]);
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  rewrite(dir, id);
  const kit = drop(dir, kept);
  for (const line of lines(opts, from, kit, kept)) console.log(line);
};

export const addCreate = (group: Command, create: (o: ExtensionCreateOptions) => Promise<void>) =>
  group
    .command('create')
    .description('Create ./extension-<id> from the extension template with the parts named')
    .argument('<id>', 'the extension id, also its host and contract name')
    .argument('[parts...]', `parts to keep (default: all seven): ${PARTS.join(', ')}`)
    .option('--from <owner/repo>', `the template repo (default: ${TEMPLATE})`)
    .action((id: string, parts: string[], o: { from?: string }) => create({ id, parts, ...o }));
