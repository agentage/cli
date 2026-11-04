import { type PlanSummary, type PlanVerb } from '../../core/installer/plan.js';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { type LoadOutcome } from '../../core/loader/load.js';
import { loadSet, scan, type Scan } from '../../core/loader/scan.js';
import { readRunState } from '../../core/loader/state.js';
import { type StaticResult, type StaticState } from '../../core/loader/states.js';
import { claimVerbs, commandNames, readHeld, type Verbs } from '../../core/loader/verbs.js';
import { loadMachine, type MachineFile, type ProfileSource } from '../../core/profile/machine.js';
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
  // What setup would do to it; null for a dev extension, which npm never installs.
  plan: PlanVerb | null;
  error: string | null;
  commands: string[];
  lastRun: { at: string; state: string; error: string | null } | null;
}

export type ProfileStatus =
  | { state: 'missing' }
  | { state: 'invalid'; errors: string[] }
  | {
      state: 'ok';
      version: number;
      source: ProfileSource;
      readOnly: boolean;
      // The etag of the account's profile this copy mirrors; null when it mirrors none.
      etag: string | null;
      // `status` only: the account's profile, when it moved past this copy.
      cloud?: { version: number; etag: string };
    };

export interface ExtensionsStatus {
  // `registered`, `status` only: whether the account knows this machine (null: not known).
  machine: { id: string; name: string; registered?: boolean | null };
  profile: ProfileStatus;
  plan: PlanSummary;
  extensions: ExtensionRow[];
}

export interface ExtensionsGather {
  status: ExtensionsStatus;
  warnings: string[];
  // name@version whose integrity the two locks disagree on.
  drift: string[];
  // Who runs each top-level verb of a kit-built extension, and what runs only namespaced.
  verbs: Verbs;
}

const profileStatus = (parsed: ProfileParse | null, machine: MachineFile): ProfileStatus => {
  if (parsed === null) return { state: 'missing' };
  if (!parsed.ok) return { state: 'invalid', errors: parsed.errors };
  const { version } = parsed.profile;
  const source = machine.profileSource;
  const etag = source === 'cloud' ? machine.profileEtag : null;
  return { state: 'ok', version, source, readOnly: parsed.readOnly, etag };
};

// A row for an invalid manifest has no trustworthy id, so it never shows another extension's run.
const lastRunOf = (p: DiscoveredExtension, s: StaticResult): ExtensionRow['lastRun'] => {
  const run = p.id === null || s.state === 'invalid' ? null : readRunState(p.id);
  return run && { at: run.at, state: run.state, error: run.error };
};

interface Seen {
  found: Scan;
  verbs: Verbs;
}

const toRow = (p: DiscoveredExtension, { found, verbs }: Seen, s: StaticResult): ExtensionRow => ({
  id: p.id,
  package: p.pkg,
  mode: p.source === 'dev' ? 'dev' : 'installed',
  wanted: found.eff.install[p.pkg] ?? null,
  installed: p.version,
  state: s.state,
  plan: p.source === 'dev' ? null : verbOf(found, p.pkg),
  error: s.error,
  commands: commandNames(p, verbs),
  lastRun: lastRunOf(p, s),
});

const verbOf = (found: Scan, pkg: string): PlanVerb | null =>
  found.plan.extensions.find((entry) => entry.name === pkg)?.verb ?? null;

// A load in this process is the run itself: its state replaces the static one.
const withRun = (row: ExtensionRow, run: LoadOutcome | undefined): ExtensionRow =>
  run ? { ...row, state: run.state, error: run.error, lastRun: null } : row;

const UNKNOWN: StaticResult = { state: 'invalid', error: null };
const STILL_INSTALLED: StaticResult = { state: 'installed', error: null };

const rowsOf = (seen: Seen, runs: ReadonlyMap<string, LoadOutcome>): ExtensionRow[] => {
  const { found, states, removed } = seen.found;
  return [
    ...found.extensions.map((p) =>
      withRun(toRow(p, seen, states.get(p.pkg) ?? UNKNOWN), runs.get(p.pkg))
    ),
    ...removed.map((p) => toRow(p, seen, STILL_INSTALLED)),
  ].sort((a, b) => (a.package < b.package ? -1 : 1));
};

export const gatherFrom = (
  found: Scan,
  runs: ReadonlyMap<string, LoadOutcome> = new Map()
): ExtensionsGather => {
  const { machine, parsed } = found;
  const seen = { found, verbs: claimVerbs(loadSet(found), readHeld()) };
  const extensions = rowsOf(seen, runs);
  const status = {
    machine: { id: machine.id, name: machine.name },
    profile: profileStatus(parsed, machine),
    plan: found.plan.summary,
    extensions,
  };
  const warnings = [...(parsed?.ok ? parsed.warnings : []), ...found.found.warnings];
  return { status, warnings, drift: found.drift, verbs: seen.verbs };
};

// Reads manifests, profile and state files; writes only a missing machine.json.
export const gatherExtensions = async (): Promise<ExtensionsGather> =>
  gatherFrom(scan(await loadMachine()));

// The report still prints first; an invalid profile.json then fails the step.
export const invalidProfileError = (profile: ProfileStatus): Error | null =>
  profile.state === 'invalid'
    ? new Error(`profile.json is invalid:\n${profile.errors.map((e) => `  ${e}`).join('\n')}`)
    : null;
