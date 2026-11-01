import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import {
  install,
  installSetProblems,
  planInstall,
  type InstallPlan,
  type InstallResult,
} from '../../core/installer/installer.js';
import { defaultProfile } from '../../core/profile/default-profile.js';
import {
  loadMachine,
  setProfileSource,
  type MachineFile,
  type ProfileSource,
} from '../../core/profile/machine.js';
import { keepMachine } from '../../core/profile/merge.js';
import { mutateProfile, readProfile } from '../../core/profile/profile.js';
import { parseProfile, type Profile, type ProfileParse } from '../../core/profile/schema.js';
import { type SetupDeps, type SetupOptions } from '../auth/setup.js';
import { rowLines } from './list.js';
import { gatherModules, type ModulesGather } from './rows.js';

export interface ModuleSetupDeps extends SetupDeps {
  readFile: (path: string) => string;
  readLocal: () => ProfileParse | null;
  loadMachine: () => Promise<MachineFile>;
  saveProfile: (fn: (current: Profile | null) => Profile) => Promise<Profile>;
  setSource: (source: ProfileSource) => Promise<unknown>;
  plan: (set: Record<string, string>) => InstallPlan;
  install: (set: Record<string, string>) => Promise<InstallResult>;
  gather: () => Promise<ModulesGather>;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const moduleSetupDeps = (base: SetupDeps): ModuleSetupDeps => ({
  ...base,
  readFile: (path) => readFileSync(path, 'utf-8'),
  readLocal: () => readProfile(),
  loadMachine: () => loadMachine(),
  saveProfile: (fn) => mutateProfile(fn),
  setSource: (source) => setProfileSource(source),
  plan: (set) => planInstall(set),
  install: (set) => install(set),
  gather: () => gatherModules(),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});

interface Source {
  label: string;
  profile: Profile;
  warnings: string[];
  // No local copy existed: the built-in default stands in for the cloud document.
  fresh: boolean;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const listed = (label: string, verdict: string, lines: string[]): Error =>
  new Error(`${label} ${verdict}:\n${lines.map((l) => `  ${l}`).join('\n')}`);

const sourceOf = (label: string, parsed: ProfileParse): Source => {
  if (!parsed.ok) throw listed(label, 'is invalid', parsed.errors);
  return { label, profile: parsed.profile, warnings: parsed.warnings, fresh: false };
};

const parseText = (raw: string): ProfileParse => {
  try {
    return parseProfile(JSON.parse(raw));
  } catch {
    return { ok: false, errors: ['not valid JSON'] };
  }
};

const fileSource = (file: string, deps: ModuleSetupDeps): Source => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file))
    throw new Error(`${file}: profile URLs are not supported; pass a file path`);
  let raw: string;
  try {
    raw = deps.readFile(file);
  } catch (err) {
    throw new Error(`cannot read profile ${file}: ${messageOf(err)}`);
  }
  return sourceOf(file, parseText(raw));
};

// Without a cloud profile: the local profile.json, else the built-in default.
const localSource = (deps: ModuleSetupDeps): Source => {
  const parsed = deps.readLocal();
  if (parsed !== null) return sourceOf('profile.json', parsed);
  return { label: 'default profile', profile: defaultProfile(), warnings: [], fresh: true };
};

// Refused before anything is written, naming each module and the rule it broke.
const checked = (source: Source): Source => {
  const problems = installSetProblems(source.profile.modules);
  if (problems.length > 0) throw listed(source.label, 'is refused', problems);
  return source;
};

const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;

const counted = (n: number): string =>
  n === 0 ? 'no modules' : `${n} module${n === 1 ? '' : 's'}`;

const npmText = (plan: InstallPlan): string => {
  if (plan.npm === null) return plan.reuse ? 'skipped, tree already installed' : 'skipped';
  if (plan.npm === 'ci') return 'ci --ignore-scripts (the lock matches package.json)';
  const why = plan.lock === null ? 'no lock yet' : 'the lock does not match package.json';
  return `install --ignore-scripts (${why})`;
};

export const planLines = (label: string, plan: InstallPlan): string[] => {
  const names = Object.keys(plan.install);
  const width = Math.max(0, ...names.map((name) => name.length));
  return [
    line('dry run', 'nothing written'),
    line('profile', label),
    line('registry', plan.registry),
    line('modules', plan.modulesDir),
    line('install', counted(names.length)),
    ...names.map((name) => `  ${name.padEnd(width)}  ${plan.install[name] ?? ''}`),
    line('npm', npmText(plan)),
    line('tree', plan.tree ?? 'named from the lock npm writes'),
  ];
};

export const installLine = (result: InstallResult): string => {
  const how = result.reused ? 'reused' : result.npm ? `npm ${result.npm}` : 'npm skipped';
  return line('install', `${counted(result.count)} in tree ${result.tree} (${how})`);
};

const printPlan = (source: Source, deps: ModuleSetupDeps): void => {
  for (const warning of source.warnings) deps.err(chalk.yellow(`warning: ${warning}`));
  for (const text of planLines(source.label, deps.plan(source.profile.modules))) deps.out(text);
};

// The rows print even after a failed install: they show what is still current.
const installAndList = async (source: Source, deps: ModuleSetupDeps): Promise<void> => {
  const outcome = await deps.install(source.profile.modules).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error })
  );
  if (outcome.result) deps.out(installLine(outcome.result));
  const { status, warnings } = await deps.gather();
  for (const text of rowLines(status.modules)) deps.out(text);
  for (const warning of warnings) deps.err(chalk.yellow(`warning: ${warning}`));
  if (outcome.error) throw outcome.error;
};

// `--profile` never signs in; this machine's own entry in the local profile is kept.
const fromFile = async (source: Source, deps: ModuleSetupDeps): Promise<void> => {
  const machine = await deps.loadMachine();
  await deps.saveProfile((current) => keepMachine(source.profile, current, machine.id));
  await deps.setSource('file');
  await installAndList(source, deps);
};

const UNAVAILABLE = 'cloud profile unavailable, using';

const fromLocal = async (deps: ModuleSetupDeps): Promise<void> => {
  const source = checked(localSource(deps));
  if (!source.fresh) deps.err(chalk.dim(`${UNAVAILABLE} local profile.json`));
  else {
    deps.err(chalk.dim(`${UNAVAILABLE} the default profile (saved locally, not synced)`));
    await deps.saveProfile(() => source.profile);
    await deps.setSource('default');
  }
  await installAndList(source, deps);
};

export const runModuleSetup = async (opts: SetupOptions, deps: ModuleSetupDeps): Promise<void> => {
  if (opts.disconnect) return deps.signOut();
  const file = opts.profile === undefined ? null : checked(fileSource(opts.profile, deps));
  if (opts.dryRun) return printPlan(file ?? checked(localSource(deps)), deps);
  if (file) return fromFile(file, deps);
  await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser });
  const failure = await fromLocal(deps).then(
    () => null,
    (error: unknown) => error
  );
  await deps.printStatus();
  if (failure) throw failure;
};
