import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Command } from 'commander';
import { addJson, CliError } from '../../lib/json-output.js';
import { installCreated, trustFrom } from './create-install.js';
import { terminalIo, type ConfirmIo } from './lifecycle.js';

const run = promisify(execFile);
export const TEMPLATE = 'agentage/extension-template';
export const PARTS = ['pages', 'ui', 'api', 'mcp', 'worker', 'store', 'cli', 'app'];
const ROUTED = ['pages', 'ui', 'api', 'mcp'];
// `_` is a separator here, so `template__echo` is the id too.
const WORD = /(?<![A-Za-z0-9])template(?![A-Za-z0-9])/g;
const LOCK = 'package-lock.json';
// owner/repo, optionally #branch: a git ref that cannot pass for a flag or leave the repo.
const FROM = /^[\w.-]+\/[\w.-]+(?:#\w[\w./-]*)?$/;
// What else goes with a dropped part: manifest keys the kit refuses without it, the store's SQL, the contract file of api and mcp.
const PRUNE: Record<string, { keys?: string[][]; paths?: string[] }> = {
  cli: { keys: [['agentage', 'commands']] },
  mcp: { keys: [['agentage', 'settings', 'mcp.listing']], paths: ['template.mcpc.json'] },
  api: { paths: ['openapi.json'] },
  store: { paths: ['migrations', 'seeds'] },
  app: { keys: [['agentage', 'app']], paths: ['src/app-part.test.tsx'] },
};

export interface ExtensionCreateOptions {
  id: string;
  parts: string[];
  from?: string;
  // commander's --no-install: false keeps the new folder out of the daemon.
  install?: boolean;
  // --yes: run code from a --from other than the template with no terminal to see the notice.
  yes?: boolean;
  json?: boolean;
}

const refusal = ({ id, parts, from = TEMPLATE }: ExtensionCreateOptions, kept: string[]) => {
  const unknown = parts.find((part) => !PARTS.includes(part));
  if (unknown) return `unknown part ${unknown}: one of ${PARTS.join(', ')}`;
  if (!/^[a-z][a-z0-9-]*$/.test(id))
    return `id ${id}: lowercase letters, digits and -, starting with a letter`;
  if (PARTS.includes(id)) return `id ${id} is a part name: pick another id`;
  if (!kept.some((part) => ROUTED.includes(part)))
    return `an extension needs at least one of ${ROUTED.join(', ')}`;
  if (!FROM.test(from) || from.includes('..'))
    return `--from ${from}: owner/repo or owner/repo#branch`;
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

// --from owner/repo[#branch], checked by refusal() first.
const repoRef = (from: string): { repo: string; ref?: string } => {
  const [repo = from, ref] = from.split('#');
  return { repo, ...(ref && { ref }) };
};

// Bounded, a partial folder removed; git's own first line says why (no repo, no network, no access).
const clone = async (url: string, from: string, dir: string): Promise<void> => {
  const { ref } = repoRef(from);
  const branch = ref ? ['--branch', ref] : [];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  await run('git', ['clone', '-q', '--depth', '1', ...branch, url, dir], {
    env,
    timeout: 120_000,
  }).catch((err: { stderr?: string; message: string }) => {
    rmSync(dir, { recursive: true, force: true });
    const why = (err.stderr?.trim() || err.message).split('\n')[0];
    throw new Error(`cannot clone template ${from}: ${why}`);
  });
  rmSync(join(dir, '.git'), { recursive: true, force: true });
};

const CI = join('.github', 'workflows', 'ci.yml');
const FLOOR = /MIN_EXECUTED: '\d+'/;

const LOWERED =
  " ci        MIN_EXECUTED is 1: after the first green run, set it to the gate's count";
const BY_HAND = ` ci        no MIN_EXECUTED line found in ${CI}: set it by hand to the gate's count`;

// The template's floor counts the gate's tests for all eight parts; a subset's count is unknown.
const lowerFloor = (dir: string, kept: string[]): string | undefined => {
  if (kept.length === PARTS.length) return undefined;
  const file = join(dir, CI);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!FLOOR.test(text)) return BY_HAND;
  writeFileSync(file, text.replace(FLOOR, "MIN_EXECUTED: '1'"));
  return LOWERED;
};

// A half-made folder is removed, so a re-run is not refused as "exists".
const shape = (dir: string, from: string, id: string, kept: string[]): string | undefined => {
  try {
    drop(dir, kept);
    rewrite(dir, id);
    renameLock(dir, id);
    return lowerFloor(dir, kept);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`template ${from}: ${(err as Error).message}`);
  }
};

const printNext = (dir: string, from: string, id: string, kept: string[]): void => {
  const kit = String(
    json(join(dir, 'package.json'))['dependencies']?.['@agentage/extension'] ?? '?'
  );
  const { repo, ref } = repoRef(from);
  const branch = ref ? `branch ${ref}` : 'default branch';
  console.log(` template  ${repo} (${branch}, kit ${kit.replace(/^[\^~]/, '')})`);
  console.log(` kept      ${kept.join(', ')}`);
  console.log(` id        ${id}  ·  host ${id}.next.agentage.io  ·  contract ${id}.mcpc.json`);
  console.log(` next      cd ${dir} && agentage extension up`);
};

// Clones the template's default branch (or the #branch of --from) into ./extension-<id> as a new working copy, no history;
// then installs its dependencies, builds it and (unless --no-install) gives it to the daemon.
export const runExtensionCreate = async (
  opts: ExtensionCreateOptions,
  url = (from: string) => `https://github.com/${from}`,
  after: typeof installCreated = installCreated,
  io: ConfirmIo = terminalIo()
): Promise<unknown> => {
  const { id, from = TEMPLATE } = opts;
  const kept = opts.parts.length > 0 ? [...new Set(opts.parts)] : PARTS;
  const refused = refusal(opts, kept);
  if (refused) throw new CliError('invalid_argument', refused);
  await trustFrom(from, opts, opts.json ? { ...io, isTTY: false } : io);
  const dir = `extension-${id}`;
  await clone(url(repoRef(from).repo), from, dir);
  const ci = shape(dir, from, id, kept);
  printNext(dir, from, id, kept);
  if (ci) console.log(ci);
  return { id, dir, from, kept, ...(await after(dir, opts.install !== false)) };
};

export const addCreate = (group: Command, create: (o: ExtensionCreateOptions) => Promise<void>) =>
  addJson(
    group
      .command('create')
      .description('Create ./extension-<id> from the extension template with the parts named')
      .argument('<id>', 'the extension id, also its host and contract name')
      .argument('[parts...]', `parts to keep (default: all eight): ${PARTS.join(', ')}`)
      .option('--from <owner/repo[#branch]>', `the template repo (default: ${TEMPLATE})`)
      .option('--no-install', 'build the folder, but do not give it to the daemon')
      .option('--yes', 'run code from another --from repo or branch without asking')
  ).action(
    (
      id: string,
      parts: string[],
      o: { from?: string; install?: boolean; yes?: boolean; json?: boolean }
    ) => create({ id, parts, ...o })
  );
