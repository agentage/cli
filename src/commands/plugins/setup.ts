import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import {
  install,
  planInstall,
  type InstallPlan,
  type InstallResult,
} from '../../core/installer/installer.js';
import { allowedScopes, installSetProblems } from '../../core/installer/scope.js';
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
import { installLine, planLines } from './setup-print.js';
import { pluginStatusLines } from './status-print.js';
import { gatherPluginStatus, type PluginsGather } from './status-rows.js';

export interface PluginsSetupDeps extends SetupDeps {
  readFile: (path: string) => string;
  readLocal: () => ProfileParse | null;
  loadMachine: () => Promise<MachineFile>;
  saveProfile: (fn: (current: Profile | null) => Profile) => Promise<Profile>;
  setSource: (source: ProfileSource) => Promise<unknown>;
  scopes: () => string[];
  plan: (set: Record<string, string>) => InstallPlan;
  install: (set: Record<string, string>) => Promise<InstallResult>;
  gather: () => Promise<PluginsGather>;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const pluginsSetupDeps = (base: SetupDeps): PluginsSetupDeps => ({
  ...base,
  readFile: (path) => readFileSync(path, 'utf-8'),
  readLocal: () => readProfile(),
  loadMachine: () => loadMachine(),
  saveProfile: (fn) => mutateProfile(fn),
  setSource: (source) => setProfileSource(source),
  scopes: () => allowedScopes(),
  plan: (set) => planInstall(set),
  install: (set) => install(set),
  gather: () => gatherPluginStatus(),
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

const parseText = (label: string, raw: string): Source => {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: not valid JSON`);
  }
  const parsed = parseProfile(doc);
  if (!parsed.ok) throw listed(label, 'is invalid', parsed.errors);
  return { label, profile: parsed.profile, warnings: parsed.warnings, fresh: false };
};

const fileSource = (file: string, deps: PluginsSetupDeps): Source => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file))
    throw new Error(`${file}: profile URLs are not supported; pass a file path`);
  let raw: string;
  try {
    raw = deps.readFile(file);
  } catch (err) {
    throw new Error(`cannot read profile ${file}: ${messageOf(err)}`);
  }
  return parseText(file, raw);
};

// No cloud route yet: the local profile.json, else the built-in default.
const localSource = (deps: PluginsSetupDeps): Source => {
  const parsed = deps.readLocal();
  if (parsed === null)
    return { label: 'default profile', profile: defaultProfile(), warnings: [], fresh: true };
  if (!parsed.ok) throw listed('profile.json', 'is invalid', parsed.errors);
  return {
    label: 'profile.json',
    profile: parsed.profile,
    warnings: parsed.warnings,
    fresh: false,
  };
};

// Refused before anything is written, naming each plugin and the rule it broke.
const checked = (source: Source, deps: PluginsSetupDeps): Source => {
  const problems = installSetProblems(source.profile.plugins, deps.scopes());
  if (problems.length > 0) throw listed(source.label, 'is refused', problems);
  for (const warning of source.warnings) deps.err(chalk.yellow(`warning: ${warning}`));
  return source;
};

const settle = async <T>(fn: () => Promise<T>): Promise<{ value: T | null; error: unknown }> => {
  try {
    return { value: await fn(), error: null };
  } catch (error) {
    return { value: null, error };
  }
};

// The summary prints even after a failed install: the rows show what is still current.
const installAndSummarize = async (set: Record<string, string>, deps: PluginsSetupDeps) => {
  const outcome = await settle(() => deps.install(set));
  if (outcome.value) deps.out(installLine(outcome.value));
  const gathered = await deps.gather();
  for (const text of pluginStatusLines(gathered.status)) deps.out(text);
  for (const warning of gathered.warnings) deps.err(chalk.yellow(`warning: ${warning}`));
  if (outcome.error) throw outcome.error;
};

const printPlan = (source: Source, deps: PluginsSetupDeps): void => {
  for (const text of planLines(source.label, deps.plan(source.profile.plugins))) deps.out(text);
};

// `--profile` never signs in and never pushes; this machine's own overrides are kept.
const fromFile = async (file: string, dryRun: boolean, deps: PluginsSetupDeps): Promise<void> => {
  const source = checked(fileSource(file, deps), deps);
  if (dryRun) return printPlan(source, deps);
  const machine = await deps.loadMachine();
  await deps.saveProfile((current) => keepMachine(source.profile, current, machine.id));
  await deps.setSource('file');
  await installAndSummarize(source.profile.plugins, deps);
};

const UNAVAILABLE = 'cloud profile unavailable, using';

const installLocal = async (deps: PluginsSetupDeps): Promise<void> => {
  const source = checked(localSource(deps), deps);
  if (source.fresh) {
    deps.err(chalk.dim(`${UNAVAILABLE} the default profile (saved locally, not synced)`));
    await deps.saveProfile(() => source.profile);
    await deps.setSource('default');
  } else deps.err(chalk.dim(`${UNAVAILABLE} local profile.json`));
  deps.out(installLine(await deps.install(source.profile.plugins)));
};

export const runPluginsSetup = async (
  opts: SetupOptions,
  deps: PluginsSetupDeps
): Promise<void> => {
  if (opts.disconnect) return deps.signOut();
  if (opts.profile !== undefined) return fromFile(opts.profile, opts.dryRun === true, deps);
  if (opts.dryRun) return printPlan(checked(localSource(deps), deps), deps);
  await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser });
  const { error } = await settle(() => installLocal(deps));
  await deps.printStatus();
  if (error) throw error;
};
