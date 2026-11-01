import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { type LoadOutcome } from '../../core/loader/load.js';
import { scan, type Scan } from '../../core/loader/scan.js';
import { readRunState } from '../../core/loader/state.js';
import { type StaticResult, type StaticState } from '../../core/loader/states.js';
import { loadMachine, type MachineFile, type ProfileSource } from '../../core/profile/machine.js';
import { type Effective } from '../../core/profile/merge.js';
import { type ProfileParse } from '../../core/profile/schema.js';

// `ok` and `failed` only after a load in this process; `blocked` also when a peer failed to load.
export type RowState = StaticState | 'ok' | 'failed';

export interface ExtensionRow {
  id: string | null;
  package: string;
  mode: 'installed' | 'dev';
  wanted: string | null;
  installed: string | null;
  state: RowState;
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

// A load in this process is the run itself: its state replaces the static one.
const withRun = (row: ExtensionRow, run: LoadOutcome | undefined): ExtensionRow =>
  run ? { ...row, state: run.state, error: run.error, lastRun: null } : row;

const UNKNOWN: StaticResult = { state: 'invalid', error: null };

export const gatherFrom = (
  found: Scan,
  runs: ReadonlyMap<string, LoadOutcome> = new Map()
): ExtensionsGather => {
  const { machine, parsed, eff, states } = found;
  const extensions = found.found.extensions
    .map((p) => withRun(toRow(p, eff, states.get(p.pkg) ?? UNKNOWN), runs.get(p.pkg)))
    .sort((a, b) => (a.package < b.package ? -1 : 1));
  const status = {
    machine: { id: machine.id, name: machine.name },
    profile: profileStatus(parsed, machine),
    extensions,
  };
  return { status, warnings: [...(parsed?.ok ? parsed.warnings : []), ...found.found.warnings] };
};

// Reads manifests, profile and state files; writes only a missing machine.json.
export const gatherExtensions = async (): Promise<ExtensionsGather> =>
  gatherFrom(scan(await loadMachine()));

// The report still prints first; an invalid profile.json then fails the step.
export const invalidProfileError = (profile: ProfileStatus): Error | null =>
  profile.state === 'invalid'
    ? new Error(`profile.json is invalid:\n${profile.errors.map((e) => `  ${e}`).join('\n')}`)
    : null;
