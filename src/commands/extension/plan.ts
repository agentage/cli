import { DEFAULT_REGISTRY } from '../../core/installer/npm.js';
import { type Plan, type PlanEntry } from '../../core/installer/plan.js';
import { readMachine } from '../../core/profile/machine.js';
import { keepMachine } from '../../core/profile/merge.js';
import { readProfile } from '../../core/profile/profile.js';
import { type Profile } from '../../core/profile/schema.js';
import { line } from './line.js';
import { accountProfileInstalled, profilePlan } from './profile-plan.js';

export interface PlanOptions {
  json?: boolean;
}

// What setup would send to the daemon, with this machine's own entry from profile.json kept. A
// file (`--profile`) is never gated; the local profile is, once the account profile was installed.
const planFor = (profile: Profile, file: boolean): Plan => {
  const local = readProfile();
  const desired = keepMachine(profile, local?.ok ? local.profile : null, readMachine()?.id ?? '');
  return profilePlan(desired, !file && accountProfileInstalled());
};

const entryLine = ({ verb, name, wanted }: PlanEntry): string =>
  verb === 'add' ? `+ add ${name} ${wanted}` : `o off ${name} ${wanted} (installed disabled)`;

// One line per extension setup would touch or leaves off, then one summary line.
export const planLines = ({ extensions, summary: s }: Plan): string[] => {
  const shown = extensions.filter((entry) => entry.verb !== 'unchanged');
  if (shown.length === 0) return ['plan: nothing to change'];
  const total = `${s.add} to add, ${s.off} off, ${s.unchanged} already installed`;
  return [...shown.map(entryLine), `plan: ${total}`];
};

// One line per scope the profile routes, then the registry for everything else.
const registryLines = (registries: Record<string, string>): string[] => {
  const all: [string, string][] = [...Object.entries(registries), ['default', DEFAULT_REGISTRY]];
  const width = Math.max(...all.map(([scope]) => scope.length));
  return all.map(([scope, url]) => line('registry', `${scope.padEnd(width)}  ${url}`));
};

// `setup --dry-run`: reads only, never creates machine.json.
export const printDryRun = (profile: Profile, opts: PlanOptions & { file: boolean }): void => {
  const plan = planFor(profile, opts.file);
  if (opts.json) return console.log(JSON.stringify(plan, null, 2));
  const header = [line('dry run', 'nothing written'), ...registryLines(profile.registries)];
  for (const text of [...header, ...planLines(plan)]) console.log(text);
};

// `setup --check`: the plan, then exit 1 for anything setup would install.
export const runSetupCheck = (profile: Profile, opts: PlanOptions & { file: boolean }): void => {
  const plan = planFor(profile, opts.file);
  const problems = readMachine() ? [] : ['machine.json: missing'];
  if (opts.json) console.log(JSON.stringify({ ...plan, problems }, null, 2));
  else for (const text of planLines(plan)) console.log(text);
  const { add, off } = plan.summary;
  const changes = [add && `${add} to add`, off && `${off} to install disabled`].filter(Boolean);
  const pending = changes.length > 0 ? [`not converged: ${changes.join(', ')}`] : [];
  if (problems.length + pending.length > 0) throw new Error([...problems, ...pending].join('\n'));
};
