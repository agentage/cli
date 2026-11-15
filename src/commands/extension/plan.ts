import { DEFAULT_REGISTRY } from '../../core/installer/npm.js';
import { existsSync } from 'node:fs';
import { type PlanEntry } from '../../core/installer/plan.js';
import { machinePath } from '../../core/paths.js';
import { readMachine } from '../../core/profile/machine.js';
import { keepMachine } from '../../core/profile/merge.js';
import { readProfile } from '../../core/profile/profile.js';
import { type Profile } from '../../core/profile/schema.js';
import { line } from './line.js';
import {
  accountProfileInstalled,
  NOT_EXTENSION,
  profilePlan,
  type ProfilePlan,
} from './profile-plan.js';

export interface PlanOptions {
  json?: boolean;
  file: boolean;
  // Where the profile came from: the --profile path, profile.json or the built-in default.
  from: string;
}

// What setup would send to the daemon, with this machine's own entry from profile.json kept. A
// file (`--profile`) is never gated; the local profile is, once the account profile was installed.
const planFor = (profile: Profile, file: boolean): ProfilePlan => {
  const local = readProfile();
  const desired = keepMachine(profile, local?.ok ? local.profile : null, readMachine()?.id ?? '');
  return profilePlan(desired, !file && accountProfileInstalled());
};

const entryLine = ({ verb, name, wanted }: PlanEntry): string =>
  verb === 'add' ? `+ add ${name} ${wanted}` : `o off ${name} ${wanted} (installed disabled)`;

// One line per extension setup would touch or leaves off, then one summary line.
export const planLines = ({ extensions, summary: s, skipped }: ProfilePlan): string[] => {
  const shown = extensions.filter((entry) => entry.verb !== 'unchanged');
  const skips = skipped.map((name) => `- ${name}: ${NOT_EXTENSION}`);
  if (shown.length === 0) return [...skips, 'plan: nothing to change'];
  const total = `${s.add} to add, ${s.off} off, ${s.unchanged} already installed`;
  return [...shown.map(entryLine), ...skips, `plan: ${total}`];
};

// --check and --dry-run read no account: the plan says which profile it is of.
const sourceLine = ({ file, from }: PlanOptions): string =>
  line('from', file ? from : `${from} on this machine; plain setup installs your account profile`);

// One line per scope the profile routes, then the registry for everything else.
const registryLines = (registries: Record<string, string>): string[] => {
  const all: [string, string][] = [...Object.entries(registries), ['default', DEFAULT_REGISTRY]];
  const width = Math.max(...all.map(([scope]) => scope.length));
  return all.map(([scope, url]) => line('registry', `${scope.padEnd(width)}  ${url}`));
};

// `setup --dry-run`: reads only, never creates machine.json.
export const printDryRun = (profile: Profile, opts: PlanOptions): void => {
  const plan = planFor(profile, opts.file);
  if (opts.json) return console.log(JSON.stringify({ ...plan, source: opts.from }, null, 2));
  const header = [line('dry run', 'nothing written'), ...registryLines(profile.registries)];
  for (const text of [...header, ...planLines(plan), sourceLine(opts)]) console.log(text);
};

// A machine.json that does not parse is not "missing": setup would not make a new one over it.
const machineProblem = (): string[] => {
  if (readMachine()) return [];
  return [
    existsSync(machinePath()) ? 'machine.json: invalid, fix or delete it' : 'machine.json: missing',
  ];
};

// `setup --check`: the plan, then exit 1 for anything setup would install.
export const runSetupCheck = (profile: Profile, opts: PlanOptions): void => {
  const plan = planFor(profile, opts.file);
  const problems = machineProblem();
  if (opts.json) console.log(JSON.stringify({ ...plan, problems, source: opts.from }, null, 2));
  else for (const text of [...planLines(plan), sourceLine(opts)]) console.log(text);
  const { add, off } = plan.summary;
  const changes = [add && `${add} to add`, off && `${off} to install disabled`].filter(Boolean);
  const pending = changes.length > 0 ? [`not converged: ${changes.join(', ')}`] : [];
  if (problems.length + pending.length > 0) throw new Error([...problems, ...pending].join('\n'));
};
