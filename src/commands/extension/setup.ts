import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import {
  install,
  planInstall,
  type InstallPlan,
  type InstallResult,
} from '../../core/installer/installer.js';
import { DEFAULT_REGISTRY, type Npm } from '../../core/installer/npm.js';
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
import { rowLines } from './list.js';
import { gatherExtensions } from './rows.js';

// Sign-in and status reach the site; npm is the one other seam.
export interface ExtensionSetupDeps extends SetupDeps {
  npm: () => Promise<Npm>;
}

interface Source {
  label: string;
  profile: Profile;
  warnings: string[];
  // No local copy existed: the built-in default stands in for the cloud document.
  fresh: boolean;
}

const sourceOf = (label: string, parsed: ProfileParse): Source => {
  if (!parsed.ok)
    throw new Error(`${label} is invalid:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}`);
  return { label, profile: parsed.profile, warnings: parsed.warnings, fresh: false };
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

// Without a cloud profile: the local profile.json, else the built-in default.
const localSource = (): Source => {
  const parsed = readProfile();
  if (parsed !== null) return sourceOf('profile.json', parsed);
  return { label: 'default profile', profile: defaultProfile(), warnings: [], fresh: true };
};

const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;

const counted = (n: number): string =>
  n === 0 ? 'no extensions' : `${n} extension${n === 1 ? '' : 's'}`;

const npmText = (plan: InstallPlan): string => {
  if (plan.npm === null) return plan.reuse ? 'skipped, tree already installed' : 'skipped';
  if (plan.npm === 'ci') return 'ci --ignore-scripts (the lock matches package.json)';
  const why = plan.lock === null ? 'no lock yet' : 'the lock does not match package.json';
  return `install --ignore-scripts (${why})`;
};

// One line per scope the profile routes, then the registry for everything else.
const registryLines = (registries: Record<string, string>): string[] => {
  const all: [string, string][] = [...Object.entries(registries), ['default', DEFAULT_REGISTRY]];
  const width = Math.max(...all.map(([scope]) => scope.length));
  return all.map(([scope, url]) => line('registry', `${scope.padEnd(width)}  ${url}`));
};

const planLines = (label: string, plan: InstallPlan): string[] => {
  const names = Object.keys(plan.install);
  const width = Math.max(0, ...names.map((name) => name.length));
  return [
    line('dry run', 'nothing written'),
    line('profile', label),
    ...registryLines(plan.registries),
    line('extensions', plan.extensionsDir),
    line('install', counted(names.length)),
    ...names.map((name) => `  ${name.padEnd(width)}  ${plan.install[name] ?? ''}`),
    line('npm', npmText(plan)),
    line('tree', plan.tree ?? 'named from the lock npm writes'),
  ];
};

const installLine = (result: InstallResult): string => {
  const how = result.reused ? 'reused' : result.npm ? `npm ${result.npm}` : 'npm skipped';
  return line('install', `${counted(result.count)} in tree ${result.tree} (${how})`);
};

const warn = (warnings: string[]): void => {
  for (const warning of warnings) console.error(chalk.yellow(`warning: ${warning}`));
};

const printPlan = (source: Source): void => {
  warn(source.warnings);
  for (const text of planLines(source.label, planInstall(source.profile))) console.log(text);
};

// The rows print even after a failed install: they show what is still current.
const installAndList = async (source: Source, deps: ExtensionSetupDeps): Promise<void> => {
  const outcome = await install(source.profile, deps.npm).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error })
  );
  if (outcome.result) console.log(installLine(outcome.result));
  const { status, warnings } = await gatherExtensions();
  for (const text of rowLines(status.extensions)) console.log(text);
  warn(warnings);
  if (outcome.error) throw outcome.error;
};

// `--profile` never signs in; this machine's own entry in the local profile is kept.
const fromFile = async (source: Source, deps: ExtensionSetupDeps): Promise<void> => {
  const machine = await loadMachine();
  await mutateProfile((current) => keepMachine(source.profile, current, machine.id));
  await setProfileSource('file');
  await installAndList(source, deps);
};

const UNAVAILABLE = 'cloud profile unavailable, using';

const fromLocal = async (deps: ExtensionSetupDeps): Promise<void> => {
  const source = localSource();
  if (!source.fresh) console.error(chalk.dim(`${UNAVAILABLE} local profile.json`));
  else {
    console.error(chalk.dim(`${UNAVAILABLE} the default profile (saved locally, not synced)`));
    await mutateProfile(() => source.profile);
    await setProfileSource('default');
  }
  await installAndList(source, deps);
};

export const runExtensionSetup = async (
  opts: SetupOptions,
  deps: ExtensionSetupDeps
): Promise<void> => {
  if (opts.disconnect) return deps.signOut();
  const file = opts.profile === undefined ? null : fileSource(opts.profile);
  if (opts.dryRun) return printPlan(file ?? localSource());
  if (file) return fromFile(file, deps);
  await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser });
  const failure = await fromLocal(deps).then(
    () => null,
    (error: unknown) => error
  );
  await deps.printStatus();
  if (failure) throw failure;
};
