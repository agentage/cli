import { DEFAULT_REGISTRY } from '../../core/installer/npm.js';
import {
  currentDependencies,
  driftLines,
  lockDrift,
  pendingChanges,
  planChanges,
  type Plan,
  type PlanEntry,
} from '../../core/installer/plan.js';
import { NO_MACHINE, readMachine, type MachineFile } from '../../core/profile/machine.js';
import { effective, keepMachine } from '../../core/profile/merge.js';
import { readProfile } from '../../core/profile/profile.js';
import { type Profile } from '../../core/profile/schema.js';
import { line } from './install-load.js';

export interface PlanOptions {
  json?: boolean;
}

// Desired: the profile, with this machine's own entry from profile.json as setup keeps it.
const planFor = (profile: Profile, machine: MachineFile | null): Plan => {
  const local = readProfile();
  const id = machine?.id ?? '';
  const desired = keepMachine(profile, local?.ok ? local.profile : null, id);
  return planChanges(effective(desired, machine ?? NO_MACHINE), currentDependencies());
};

const entryLine = ({ verb, name, wanted, current }: PlanEntry): string => {
  if (verb === 'add') return `+ add ${name} ${wanted}`;
  if (verb === 'update') return `~ update ${name} ${wanted} (was ${current})`;
  return verb === 'remove' ? `- remove ${name}` : `o off ${name}`;
};

// One line per extension setup would touch or leaves off, then one summary line.
export const planLines = ({ extensions, summary: s }: Plan): string[] => {
  const shown = extensions.filter((entry) => entry.verb !== 'unchanged');
  if (shown.length === 0) return ['plan: nothing to change'];
  const total = `${s.add} to add, ${s.update} to update, ${s.remove} to remove`;
  return [...shown.map(entryLine), `plan: ${total}, ${s.off} off, ${s.unchanged} unchanged`];
};

// One line per scope the profile routes, then the registry for everything else.
const registryLines = (registries: Record<string, string>): string[] => {
  const all: [string, string][] = [...Object.entries(registries), ['default', DEFAULT_REGISTRY]];
  const width = Math.max(...all.map(([scope]) => scope.length));
  return all.map(([scope, url]) => line('registry', `${scope.padEnd(width)}  ${url}`));
};

// `setup --dry-run`: reads only, never creates machine.json.
export const printDryRun = (profile: Profile, opts: PlanOptions): void => {
  const plan = planFor(profile, readMachine());
  if (opts.json) return console.log(JSON.stringify(plan, null, 2));
  const header = [line('dry run', 'nothing written'), ...registryLines(profile.registries)];
  for (const text of [...header, ...planLines(plan)]) console.log(text);
};

const LOCK_MISMATCH = 'lock mismatch: extensions/package-lock.json does not match the current tree';

// What applying the plan would not fix: a lock that disagrees with its tree.
const lockProblems = (): string[] => {
  const { integrity, matches } = lockDrift();
  if (integrity.length > 0) return driftLines(integrity);
  return matches ? [] : [LOCK_MISMATCH];
};

// `setup --check`: the plan, then exit 1 for anything setup would change or cannot trust.
export const runSetupCheck = (profile: Profile, opts: PlanOptions): void => {
  const machine = readMachine();
  const plan = planFor(profile, machine);
  const problems = [...(machine ? [] : ['machine.json: missing']), ...lockProblems()];
  if (opts.json) console.log(JSON.stringify({ ...plan, problems }, null, 2));
  else for (const text of planLines(plan)) console.log(text);
  const changes = pendingChanges(plan.summary);
  const pending = changes.length > 0 ? [`not converged: ${changes.join(', ')}`] : [];
  if (problems.length + pending.length > 0) throw new Error([...problems, ...pending].join('\n'));
};
