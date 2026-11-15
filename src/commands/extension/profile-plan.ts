import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Plan, type PlanEntry, type PlanVerb } from '../../core/installer/plan.js';
import { installationRows } from '../../core/loader/installed.js';
import { readMachine } from '../../core/profile/machine.js';
import { type Profile } from '../../core/profile/schema.js';
import { getConfigDir } from '../../lib/fs/config.js';

const PACKAGE_ID = /^(?:@agentage\/extension-|agentage-extension-)([a-z][a-z0-9-]*)$/;

// Written once plain setup tried every entry of the account profile: once per machine.
export const profileMarkerPath = (): string => join(getConfigDir(), 'setup.profile-installed');
export const accountProfileInstalled = (): boolean => existsSync(profileMarkerPath());

// A profile entry the daemon can never install: said once, never a change to make.
export const NOT_EXTENSION = 'not an extension, skipped';

export interface ProfileEntry {
  name: string;
  range: string;
  // null: not an @agentage/extension-<id> package, so the daemon cannot install it.
  id: string | null;
  // This machine's profile entry turns it off: it is installed with enabled false.
  off: boolean;
}

export const profileEntries = (profile: Profile): ProfileEntry[] => {
  const off = profile.machines[readMachine()?.id ?? '']?.off ?? [];
  return Object.entries(profile.extensions).map(([name, range]) => ({
    name,
    range,
    id: PACKAGE_ID.exec(name)?.[1] ?? null,
    off: off.includes(name),
  }));
};

const verbOf = (entry: ProfileEntry, have: Set<string>, done: boolean): PlanVerb => {
  if (done || (entry.id !== null && have.has(entry.id))) return 'unchanged';
  return entry.off ? 'off' : 'add';
};

// skipped: the entries that are no extension (no @agentage/extension- prefix), never installed.
export type ProfilePlan = Plan & { skipped: string[] };

// What setup would send to the daemon: add, add disabled (off), or nothing (unchanged). Reads
// installation.json only; `done` is a plain setup that installed the account profile already.
export const profilePlan = (profile: Profile, done: boolean): ProfilePlan => {
  const rows = new Map(installationRows().map((row) => [row.id, row]));
  const entries = profileEntries(profile);
  const extensions: PlanEntry[] = entries.flatMap((entry) =>
    entry.id === null
      ? []
      : [
          {
            verb: verbOf(entry, new Set(rows.keys()), done),
            name: entry.name,
            wanted: entry.range,
            current: rows.has(entry.id) ? 'installed' : null,
          },
        ]
  );
  const summary = { add: 0, update: 0, remove: 0, off: 0, unchanged: 0 };
  for (const entry of extensions) summary[entry.verb] += 1;
  const skipped = entries.filter((entry) => entry.id === null).map((entry) => entry.name);
  return { extensions, summary, skipped };
};
