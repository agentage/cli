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
import { printDryRun, runSetupCheck } from './plan.js';
import { printWarnings } from './row-lines.js';
import { accountSetup, disconnect } from './setup-cloud.js';
import { installThroughDaemon } from './setup-install.js';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { daemonOff } from '../../lib/daemon/daemon-file.js';
import { type EditDeps } from './sync.js';
import { CliError } from '../../lib/json-output.js';

// Sign-in and status reach the site; npm and the account are the other seams.
export interface ExtensionSetupDeps extends SetupDeps, EditDeps {
  // The daemon the profile installs through on a machine with no installation.json.
  host: () => Promise<HostClient>;
  // `extension update`, which --latest now runs.
  updateExtensions: () => Promise<unknown>;
}

interface Source {
  profile: Profile;
  warnings: string[];
  // The file it was read from, for the plan's `from` line.
  from: string;
}

const sourceOf = (label: string, parsed: ProfileParse): Source => {
  if (!parsed.ok)
    throw new CliError('profile_invalid', `${label} is invalid: ${parsed.errors.join('; ')}`);
  return { profile: parsed.profile, warnings: parsed.warnings, from: label };
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
  return { profile: defaultProfile(), warnings: [], from: 'the built-in default profile' };
};

// --check and --dry-run read only and never sign in.
const readOnly = (source: Source, opts: SetupOptions, file: boolean): void => {
  printWarnings(source.warnings);
  const plan = { ...opts, file, from: source.from };
  if (opts.check) runSetupCheck(source.profile, plan);
  else printDryRun(source.profile, plan);
};

const noDaemon = (opts: SetupOptions): boolean => opts.daemon === false || daemonOff();

// `--profile` never signs in nor calls the account; it installs through the daemon as plain setup.
const fromFile = async (source: Source, opts: SetupOptions, deps: ExtensionSetupDeps) => {
  const machine = await loadMachine();
  await mutateProfile((current) => keepMachine(source.profile, current, machine.id));
  await setProfileSource('file');
  await installThroughDaemon(source.profile, {
    host: deps.host,
    daemonOff: noDaemon(opts),
    from: 'file',
  });
};

// The daemon needs no account; --no-daemon or AGENTAGE_NO_DAEMON=1 leave it off.
const startDaemon = async (opts: SetupOptions, deps: ExtensionSetupDeps): Promise<void> => {
  if (noDaemon(opts)) return;
  console.log(`daemon running on 127.0.0.1:${await deps.startDaemon()}`);
};

// Plain setup installs the profile only through the daemon (one install path).
const profileDeps = (opts: SetupOptions, deps: ExtensionSetupDeps) => ({
  ...deps,
  installProfile: (profile: Profile) =>
    installThroughDaemon(profile, {
      host: deps.host,
      daemonOff: noDaemon(opts),
      from: 'account',
    }),
});

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
  if (opts.check || opts.dryRun) return readOnly(file ?? localSource(), opts, file !== null);
  if (file) return fromFile(file, opts, deps);
  if (opts.latest) {
    console.error('setup --latest is now: agentage extension update');
    return void (await deps.updateExtensions());
  }
  const token = process.env['AGENTAGE_TOKEN'];
  await signIn(opts, deps);
  const failure = await accountSetup(profileDeps(opts, deps)).then(
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
  return undefined;
};
