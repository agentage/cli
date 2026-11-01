import { discover, type DiscoveredExtension } from '../../core/loader/discover.js';
import { readRunState } from '../../core/loader/state.js';
import { staticStates, type StaticResult, type StaticState } from '../../core/loader/states.js';
import { extensionsDir } from '../../core/paths.js';
import { loadMachine, type MachineFile, type ProfileSource } from '../../core/profile/machine.js';
import { effective, type Effective } from '../../core/profile/merge.js';
import { readProfile } from '../../core/profile/profile.js';
import { type ProfileParse } from '../../core/profile/schema.js';

export interface ExtensionRow {
  id: string | null;
  package: string;
  mode: 'installed' | 'dev';
  wanted: string | null;
  installed: string | null;
  state: StaticState;
  error: string | null;
  commands: string[];
  lastRun: { at: string; state: string; error: string | null } | null;
}

export type ProfileStatus =
  | { state: 'missing' }
  | { state: 'invalid'; errors: string[] }
  | { state: 'ok'; version: number; source: ProfileSource; readOnly: boolean };

export interface ExtensionsStatus {
  machine: { id: string; name: string };
  profile: ProfileStatus;
  extensions: ExtensionRow[];
}

export interface ExtensionsGather {
  status: ExtensionsStatus;
  warnings: string[];
}

const profileStatus = (parsed: ProfileParse | null, machine: MachineFile): ProfileStatus => {
  if (parsed === null) return { state: 'missing' };
  if (!parsed.ok) return { state: 'invalid', errors: parsed.errors };
  const { version } = parsed.profile;
  return { state: 'ok', version, source: machine.profileSource, readOnly: parsed.readOnly };
};

// A row for an invalid manifest has no trustworthy id, so it never shows another extension's run.
const lastRunOf = (p: DiscoveredExtension, s: StaticResult): ExtensionRow['lastRun'] => {
  const run = p.id === null || s.state === 'invalid' ? null : readRunState(p.id);
  return run && { at: run.at, state: run.state, error: run.error };
};

const toRow = (p: DiscoveredExtension, eff: Effective, s: StaticResult): ExtensionRow => ({
  id: p.id,
  package: p.pkg,
  mode: p.source === 'dev' ? 'dev' : 'installed',
  wanted: eff.install[p.pkg] ?? null,
  installed: p.version,
  state: s.state,
  error: s.error,
  commands: p.commands,
  lastRun: lastRunOf(p, s),
});

const UNKNOWN: StaticResult = { state: 'invalid', error: null };

// Reads manifests, profile and state files; writes only a missing machine.json.
export const gatherExtensions = async (): Promise<ExtensionsGather> => {
  const machine = await loadMachine();
  const parsed = readProfile();
  const eff = effective(parsed?.ok ? parsed.profile : null, machine);
  const names = Object.keys(eff.install);
  const found = discover({ extensionsDir: extensionsDir(), names, dev: eff.dev });
  const states = staticStates(found.extensions, eff.off);
  const extensions = found.extensions
    .map((p) => toRow(p, eff, states.get(p.pkg) ?? UNKNOWN))
    .sort((a, b) => (a.package < b.package ? -1 : 1));
  const status = {
    machine: { id: machine.id, name: machine.name },
    profile: profileStatus(parsed, machine),
    extensions,
  };
  return { status, warnings: [...(parsed?.ok ? parsed.warnings : []), ...found.warnings] };
};

// The report still prints first; an invalid profile.json then fails the step.
export const invalidProfileError = (profile: ProfileStatus): Error | null =>
  profile.state === 'invalid'
    ? new Error(`profile.json is invalid:\n${profile.errors.map((e) => `  ${e}`).join('\n')}`)
    : null;
