import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { type Npm } from '../../core/installer/npm.js';
import { candidatesFor } from '../../core/installer/resolve.js';
import { ID_PATTERN } from '../../core/loader/manifest.js';
import { scan, type Scan } from '../../core/loader/scan.js';
import { dataDir, stateDir } from '../../core/paths.js';
import { changeProfile, dropExtension } from '../../core/profile/edit.js';
import { loadMachine, setDev } from '../../core/profile/machine.js';
import { editableProfile } from '../../core/profile/profile.js';
import { installAndLoad, line } from './install-load.js';

export interface ExtensionRemoveOptions {
  name: string;
  purge?: boolean;
  yes?: boolean;
}

// The one seam besides npm: a real terminal cannot run inside a test.
export interface ConfirmIo {
  isTTY: boolean;
  prompt: (question: string) => Promise<string>;
}

export interface ExtensionRemoveDeps {
  npm: () => Promise<Npm>;
  io: ConfirmIo;
}

interface Target {
  pkg: string;
  // Only an id fit for a path: it names state/<id>.json and data/<id>/.
  id: string | null;
}

const askLine = async (question: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

export const terminalIo = (): ConfirmIo => ({
  isTTY: process.stdin.isTTY === true,
  prompt: askLine,
});

const idOf = (pkg: string, found: Scan): string | null => {
  const id = found.found.extensions.find((e) => e.pkg === pkg)?.id ?? null;
  return id !== null && ID_PATTERN.test(id) ? id : null;
};

// A package name, then the names a short name stands for, then an extension id.
const targetOf = (input: string, found: Scan): Target => {
  const names = new Set([...Object.keys(found.eff.install), ...Object.keys(found.eff.dev)]);
  const pkg =
    [input, ...candidatesFor(input)].find((name) => names.has(name)) ??
    found.found.extensions.find((e) => e.id === input)?.pkg;
  if (pkg === undefined) throw new Error(`${input} is not installed`);
  return { pkg, id: idOf(pkg, found) };
};

// Checked against every extension the profile or a dev path names, not only what loads here.
const refuseDependents = (pkg: string, found: Scan): void => {
  const dependents = found.found.extensions
    .filter((e) => e.pkg !== pkg && e.peers.includes(pkg) && !e.optionalPeers.includes(pkg))
    .map((e) => e.id ?? e.pkg)
    .join(', ');
  if (dependents) throw new Error(`${pkg} is needed by ${dependents}; remove ${dependents} first`);
};

// Asked before anything changes, so a refusal or Ctrl+C leaves everything as it was.
const purgeConfirmed = async (opts: ExtensionRemoveOptions, target: Target, io: ConfirmIo) => {
  if (!opts.purge) return false;
  if (target.id === null)
    throw new Error(`--purge needs the extension id of ${target.pkg}, which is not installed here`);
  const data = dataDir(target.id);
  if (opts.yes) return true;
  if (!io.isTTY) throw new Error(`--purge without a terminal needs --yes (it deletes ${data})`);
  return /^y(es)?$/i.test((await io.prompt(`delete ${data} and everything in it? [y/N] `)).trim());
};

const drop = async ({ pkg, id }: Target, found: Scan): Promise<void> => {
  if (pkg in found.eff.install)
    await changeProfile((profile) => dropExtension(profile, pkg, found.machine.id));
  if (pkg in found.eff.dev) await setDev(pkg, null);
  if (id !== null) rmSync(join(stateDir(), `${id}.json`), { force: true });
  console.log(line('removed', pkg));
};

// Nothing stays loaded to dispose: the CLI process loads extensions only for one command.
export const runExtensionRemove = async (
  opts: ExtensionRemoveOptions,
  deps: ExtensionRemoveDeps
): Promise<void> => {
  editableProfile(); // an invalid or newer profile.json stops here, before anything changes
  const found = scan(await loadMachine());
  const target = targetOf(opts.name, found);
  refuseDependents(target.pkg, found);
  const purge = await purgeConfirmed(opts, target, deps.io);
  await drop(target, found);
  if (purge && target.id !== null) {
    rmSync(dataDir(target.id), { recursive: true, force: true });
    console.log(line('purged', dataDir(target.id)));
  }
  await installAndLoad(editableProfile(), deps.npm);
};
