import { readFileSync } from 'node:fs';
import { loadMachine, setProfileSource } from '../../core/profile/machine.js';
import { keepMachine } from '../../core/profile/merge.js';
import {
  defaultProfile,
  mutateProfile,
  parseProfileText,
  readProfile,
} from '../../core/profile/profile.js';
import { type Profile, type ProfileParse } from '../../core/profile/schema.js';
import { type SetupDeps, type SetupOptions } from '../auth/setup.js';
import { installAndLoad } from './install-load.js';
import { printDryRun, runSetupCheck } from './plan.js';
import { printWarnings } from './row-lines.js';
import { accountSetup, disconnect } from './setup-cloud.js';
import { type EditDeps } from './sync.js';

// Sign-in and status reach the site; npm and the account are the other seams.
export interface ExtensionSetupDeps extends SetupDeps, EditDeps {}

interface Source {
  profile: Profile;
  warnings: string[];
}

const sourceOf = (label: string, parsed: ProfileParse): Source => {
  if (!parsed.ok)
    throw new Error(`${label} is invalid:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}`);
  return { profile: parsed.profile, warnings: parsed.warnings };
};

const fileSource = (file: string): Source => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file))
    throw new Error(`${file}: profile URLs are not supported; pass a file path`);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch (err) {
    throw new Error(`cannot read profile ${file}: ${(err as Error).message}`);
  }
  return sourceOf(file, parseProfileText(raw));
};

// For --check and --dry-run: the local profile.json, else the built-in default.
const localSource = (): Source => {
  const parsed = readProfile();
  if (parsed !== null) return sourceOf('profile.json', parsed);
  return { profile: defaultProfile(), warnings: [] };
};

// --check and --dry-run read only and never sign in.
const readOnly = (source: Source, opts: SetupOptions): void => {
  printWarnings(source.warnings);
  if (opts.check) runSetupCheck(source.profile, opts);
  else printDryRun(source.profile, opts);
};

// `--profile` never signs in nor calls the account; this machine's own entry is kept.
const fromFile = async (source: Source, deps: ExtensionSetupDeps): Promise<void> => {
  const machine = await loadMachine();
  await mutateProfile((current) => keepMachine(source.profile, current, machine.id));
  await setProfileSource('file');
  await installAndLoad(source.profile, deps.npm);
};

export const runExtensionSetup = async (
  opts: SetupOptions,
  deps: ExtensionSetupDeps
): Promise<void> => {
  if (opts.disconnect) return disconnect(deps);
  const file = opts.profile === undefined ? null : fileSource(opts.profile);
  if (opts.check || opts.dryRun) return readOnly(file ?? localSource(), opts);
  if (file) return fromFile(file, deps);
  await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser });
  const token = process.env['AGENTAGE_TOKEN'];
  const failure = await accountSetup(deps).then(
    () => null,
    (error: unknown) => error
  );
  await deps.printStatus({ token });
  if (failure) throw failure;
};
