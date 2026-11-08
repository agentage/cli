import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Command } from 'commander';

const run = promisify(execFile);
export const TEMPLATE = 'agentage/extension-template';
export const PARTS = ['pages', 'ui', 'api', 'mcp', 'worker', 'store', 'cli'];
const ROUTED = ['pages', 'ui', 'api', 'mcp'];
// `_` is a separator here, so `template__echo` is the id too.
const WORD = /(?<![A-Za-z0-9])template(?![A-Za-z0-9])/g;
const LOCK = 'package-lock.json';
// What else goes with a dropped part: manifest keys the kit refuses without it, the store's SQL, the contract file of api and mcp.
const PRUNE: Record<string, { keys?: string[][]; paths?: string[] }> = {
  cli: { keys: [['agentage', 'commands']] },
  mcp: { keys: [['agentage', 'settings', 'mcp.listing']], paths: ['template.mcpc.json'] },
  api: { paths: ['openapi.json'] },
  store: { paths: ['migrations', 'seeds'] },
};

export interface ExtensionCreateOptions {
  id: string;
  parts: string[];
  from?: string;
}

const refusal = ({ id, parts, from = TEMPLATE }: ExtensionCreateOptions, kept: string[]) => {
  const unknown = parts.find((part) => !PARTS.includes(part));
  if (unknown) return `unknown part ${unknown}: one of ${PARTS.join(', ')}`;
  if (!/^[a-z][a-z0-9-]*$/.test(id))
    return `id ${id}: lowercase letters, digits and -, starting with a letter`;
  if (PARTS.includes(id)) return `id ${id} is a part name: pick another id`;
  if (!kept.some((part) => ROUTED.includes(part)))
    return `an extension needs at least one of ${ROUTED.join(', ')}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(from)) return `--from ${from}: owner/repo`;
  return existsSync(`extension-${id}`)
    ? `extension-${id} exists: pick another id or remove it`
    : '';
};

// A JSON document read loosely: only the keys create touches are looked at.
interface Doc {
  [key: string]: Doc | undefined;
}
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Doc;
const save = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// A dropped part goes with its folder (its tests beside it) and what PRUNE names.
const drop = (dir: string, kept: string[]): void => {
  const pkg = json(join(dir, 'package.json'));
  for (const part of PARTS.filter((part) => !kept.includes(part))) {
    delete pkg['agentage']?.parts?.[part];
    for (const sub of [join('src', part), ...(PRUNE[part]?.paths ?? [])])
      rmSync(join(dir, sub), { recursive: true, force: true });
    for (const path of PRUNE[part]?.keys ?? []) {
      const parent = path.slice(0, -1).reduce<Doc | undefined>((at, key) => at?.[key], pkg);
      if (parent) delete parent[path.at(-1) ?? ''];
    }
  }
  save(join(dir, 'package.json'), pkg);
};

// Every word `template` in a text file or a file name is the id: package name, host, contract.
const rewrite = (dir: string, id: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewrite(path, id);
    const text = entry.isFile() && entry.name !== LOCK ? readFileSync(path, 'utf8') : '\0';
    const next = text.replace(WORD, id);
    if (!text.includes('\0') && next !== text) writeFileSync(path, next);
    const name = entry.name.replace(WORD, id);
    if (name !== entry.name) renameSync(path, join(dir, name));
  }
};

// The lock names many packages called template (`@babel/template`): only its own name changes.
const renameLock = (dir: string, id: string): void => {
  if (!existsSync(join(dir, LOCK))) return;
  const lock = json(join(dir, LOCK));
  const name = `@agentage/extension-${id}`;
  for (const at of [lock, lock['packages']?.['']]) if (at) Object.assign(at, { name });
  save(join(dir, LOCK), lock);
};

const clone = async (url: string, from: string, dir: string): Promise<void> => {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  await run('git', ['clone', '-q', '--depth', '1', url, dir], { env }).catch(() => {
    throw new Error(`template ${from} not found`);
  });
  rmSync(join(dir, '.git'), { recursive: true, force: true });
};

// Clones the template's default branch into ./extension-<id> as a new working copy, no history.
export const runExtensionCreate = async (
  opts: ExtensionCreateOptions,
  url = (from: string) => `https://github.com/${from}`
): Promise<void> => {
  const { id, from = TEMPLATE } = opts;
  const kept = opts.parts.length > 0 ? [...new Set(opts.parts)] : PARTS;
  const refused = refusal(opts, kept);
  if (refused) throw new Error(refused);
  const dir = `extension-${id}`;
  await clone(url(from), from, dir);
  drop(dir, kept);
  rewrite(dir, id);
  renameLock(dir, id);
  const kit = String(
    json(join(dir, 'package.json'))['dependencies']?.['@agentage/extension'] ?? '?'
  );
  console.log(` template  ${from} (default branch, kit ${kit.replace(/^[\^~]/, '')})`);
  console.log(` kept      ${kept.join(', ')}`);
  console.log(` id        ${id}  ·  host ${id}.next.agentage.io  ·  contract ${id}.mcpc.json`);
  console.log(` next      cd ${dir} && npm ci && npm run build && agentage extension check`);
};

export const addCreate = (group: Command, create: (o: ExtensionCreateOptions) => Promise<void>) =>
  group
    .command('create')
    .description('Create ./extension-<id> from the extension template with the parts named')
    .argument('<id>', 'the extension id, also its host and contract name')
    .argument('[parts...]', `parts to keep (default: all seven): ${PARTS.join(', ')}`)
    .option('--from <owner/repo>', `the template repo (default: ${TEMPLATE})`)
    .action((id: string, parts: string[], o: { from?: string }) => create({ id, parts, ...o }));
