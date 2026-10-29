import {
  discover,
  type DiscoveredPlugin,
  type DiscoverInput,
  type Discovery,
} from '../../core/loader/discover.js';
import { readRunState, type RunState } from '../../core/loader/state.js';
import { staticStates, type StaticResult, type StaticState } from '../../core/loader/states.js';
import { pluginsDir } from '../../core/paths.js';
import { loadMachine, type MachineFile, type ProfileSource } from '../../core/profile/machine.js';
import { effective, type Effective } from '../../core/profile/merge.js';
import { readProfile } from '../../core/profile/profile.js';
import { type ProfileParse } from '../../core/profile/schema.js';

export interface PluginRow {
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

export interface PluginsStatus {
  machine: { id: string; name: string };
  profile: ProfileStatus;
  plugins: PluginRow[];
}

export interface PluginsGather {
  status: PluginsStatus;
  warnings: string[];
}

export interface StatusRowsDeps {
  loadMachine: () => Promise<MachineFile>;
  readProfile: () => ProfileParse | null;
  discover: (input: DiscoverInput) => Discovery;
  readRunState: (id: string) => RunState | null;
  pluginsDir: () => string;
}

const defaultDeps: StatusRowsDeps = {
  loadMachine: () => loadMachine(),
  readProfile: () => readProfile(),
  discover: (input) => discover(input),
  readRunState: (id) => readRunState(id),
  pluginsDir,
};

const profileStatus = (parsed: ProfileParse | null, machine: MachineFile): ProfileStatus => {
  if (parsed === null) return { state: 'missing' };
  if (!parsed.ok) return { state: 'invalid', errors: parsed.errors };
  const { version } = parsed.profile;
  return { state: 'ok', version, source: machine.profileSource, readOnly: parsed.readOnly };
};

// A row for an invalid manifest has no trustworthy id, so it never shows another plugin's run.
const lastRunOf = (
  p: DiscoveredPlugin,
  s: StaticResult,
  deps: StatusRowsDeps
): PluginRow['lastRun'] => {
  const run = p.id === null || s.state === 'invalid' ? null : deps.readRunState(p.id);
  return run && { at: run.at, state: run.state, error: run.error };
};

const toRow = (
  p: DiscoveredPlugin,
  eff: Effective,
  s: StaticResult,
  deps: StatusRowsDeps
): PluginRow => ({
  id: p.id,
  package: p.pkg,
  mode: p.source === 'dev' ? 'dev' : 'installed',
  wanted: eff.install[p.pkg] ?? null,
  installed: p.version,
  state: s.state,
  error: s.error,
  commands: p.commands,
  lastRun: lastRunOf(p, s, deps),
});

const UNKNOWN: StaticResult = { state: 'invalid', error: null };

// Reads manifests, profile and state files; writes only a missing machine.json.
export const gatherPluginStatus = async (
  deps: StatusRowsDeps = defaultDeps
): Promise<PluginsGather> => {
  const machine = await deps.loadMachine();
  const parsed = deps.readProfile();
  const eff = effective(parsed?.ok ? parsed.profile : null, machine);
  const names = Object.keys(eff.install);
  const found = deps.discover({ pluginsDir: deps.pluginsDir(), names, dev: eff.dev });
  const states = staticStates(found.plugins, eff.off);
  const plugins = found.plugins
    .map((p) => toRow(p, eff, states.get(p.pkg) ?? UNKNOWN, deps))
    .sort((a, b) => (a.package < b.package ? -1 : 1));
  const status = {
    machine: { id: machine.id, name: machine.name },
    profile: profileStatus(parsed, machine),
    plugins,
  };
  return { status, warnings: [...(parsed?.ok ? parsed.warnings : []), ...found.warnings] };
};
