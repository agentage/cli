import { readFileSync } from 'node:fs';
import { rawPatToken } from '../../lib/auth/credentials.js';
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
import { extensionsResult, installAndLoad } from './install-load.js';
import { runSetupLatest } from './latest.js';
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

// The daemon needs no account; --no-daemon or AGENTAGE_NO_DAEMON=1 leave it off.
const startDaemon = async (opts: SetupOptions, deps: ExtensionSetupDeps): Promise<void> => {
  if (opts.daemon === false || process.env['AGENTAGE_NO_DAEMON'] === '1') return;
  console.log(`daemon running on 127.0.0.1:${await deps.startDaemon()}`);
};

// A token is the headless credential: no browser and no callback, so --reauth has nothing to do.
const signIn = async (opts: SetupOptions, deps: ExtensionSetupDeps): Promise<void> => {
  if (!rawPatToken())
    return void (await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser }));
  if (opts.reauth)
    console.error('--reauth does nothing: AGENTAGE_TOKEN is set and is the credential');
};

const setupFlow = async (opts: SetupOptions, deps: ExtensionSetupDeps): Promise<void> => {
  if (opts.disconnect) return disconnect(deps);
  const file = opts.profile === undefined ? null : fileSource(opts.profile);
  if (opts.check || opts.dryRun) return readOnly(file ?? localSource(), opts);
  if (file) return fromFile(file, deps);
  if (opts.latest) return runSetupLatest(deps);
  const token = process.env['AGENTAGE_TOKEN'];
  await signIn(opts, deps);
  const failure = await accountSetup(deps).then(
    () => null,
    (error: unknown) => error
  );
  await deps.printStatus({ token });
  await startDaemon(opts, deps);
  if (failure) throw failure;
};

export const runExtensionSetup = async (
  opts: SetupOptions,
  deps: ExtensionSetupDeps
): Promise<unknown> => {
  await setupFlow(opts, deps);
  return opts.check || opts.dryRun ? undefined : extensionsResult(opts.json);
};
