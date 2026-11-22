import { execFile } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { holdSignals } from '../../core/loader/dispose.js';

const run = promisify(execFile);
// The kit repo holds the template in its folder template/; the old repo held it at its root.
export const TEMPLATE = 'agentage/kit:template';
export const OWN_TEMPLATES = [
  TEMPLATE,
  'agentage/platform:template',
  'agentage/extension-template',
];
// owner/repo, then #branch and :folder, each optional: nothing that can pass for a flag or leave the repo.
const FROM = /^[\w.-]+\/[\w.-]+(?:#\w[\w./-]*)?(?::\w[\w.-]*(?:\/\w[\w.-]*)*)?$/;

export const fromRefusal = (from: string): string =>
  !FROM.test(from) || from.includes('..')
    ? `--from ${from}: owner/repo, owner/repo#branch, either with :folder`
    : '';

// --from owner/repo[#branch][:folder], checked by fromRefusal() first; a git ref has no `:`.
export const repoRef = (from: string): { repo: string; ref?: string; folder?: string } => {
  const [head = from, folder] = from.split(':');
  const [repo = head, ref] = head.split('#');
  return { repo, ...(ref && { ref }), ...(folder && { folder }) };
};

// Bounded; git's own first line says why (no repo, no network, no access).
const gitClone = (url: string, from: string, into: string) => {
  const { ref } = repoRef(from);
  const branch = ref ? ['--branch', ref] : [];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  return run('git', ['clone', '-q', '--depth', '1', ...branch, url, into], {
    env,
    timeout: 120_000,
  }).catch((err: { stderr?: string; message: string }) => {
    const why = (err.stderr?.trim() || err.message).split('\n')[0];
    throw new Error(`cannot clone template ${from}: ${why}`);
  });
};

// Real folders on the whole path: a link could point the move and the rewrite outside the repo.
const takeFolder = (into: string, folder: string, from: string, dir: string): void => {
  const steps = folder.split('/').map((_, at, all) => join(into, ...all.slice(0, at + 1)));
  if (!steps.every((step) => lstatSync(step, { throwIfNoEntry: false })?.isDirectory()))
    throw new Error(`cannot clone template ${from}: no folder ${folder} in the repo`);
  renameSync(join(into, folder), dir);
};

// No link at all (the kit's template has none); walked by hand, as a recursive readdir follows links in a loop.
const refuseLinks = (dir: string, from: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`template ${from}: a symbolic link ${path}`);
    if (entry.isDirectory()) refuseLinks(path, from);
  }
};

// Removes only what this run made; also the Ctrl-C path, so it never throws.
export const removeOwn = (path: string): void => rmSync(path, { recursive: true, force: true });

// A fresh name beside the new folder (a rename across disks fails), so no folder of yours is reused.
const cloneFolder = (dir: string, folder?: string): string =>
  folder ? mkdtempSync(`.${dir}.clone-`) : dir;

// With :folder only that folder stays; a signal during the clone removes this run's folders, then exits as it would.
export const clone = async (url: string, from: string, dir: string): Promise<void> => {
  const { folder } = repoRef(from);
  const into = cloneFolder(dir, folder);
  const release = holdSignals(async () => [into, dir].forEach(removeOwn));
  try {
    await gitClone(url, from, into);
    if (folder) takeFolder(into, folder, from, dir);
    removeOwn(join(dir, '.git'));
    refuseLinks(dir, from);
  } catch (err) {
    removeOwn(dir);
    throw err;
  } finally {
    release();
    if (folder) removeOwn(into);
  }
};
