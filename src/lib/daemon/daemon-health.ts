import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../fs/config.js';
import { probe, type Health, type HealthEntry } from './daemon-probe.js';

// One change the daemon took and has not answered (kit 0.14 /health `pending`).
export interface PendingChange {
  op: string;
  id?: string;
  source?: string;
  since: string;
  timedOut?: true;
}

// What /health of kit 0.14 adds; each is absent when there is nothing to say.
export interface HealthMarks {
  pending?: PendingChange[];
  unsynced?: string[];
  installation?: 'invalid' | 'unreadable';
  installationError?: string;
  // C2: off below the Node floor, with the reason in sealError.
  seal?: 'on' | 'off';
  sealError?: string;
  clockRate?: number;
}

const UNSETTLED = ['starting', 'failed'];

// The kit keeps a copy only of a file whose rows it refused at boot, not of one that later broke.
const invalidReason = (): string =>
  existsSync(join(getConfigDir(), 'installation.json.bad'))
    ? 'installation.json is invalid: the daemon kept the bad file as installation.json.bad'
    : 'installation.json is invalid';

// Why the daemon says degraded: every cause the kit counts, in words; empty when ok.
export const degradedReasons = (health: Health & HealthMarks): string[] => {
  if (health.status === 'ok') return [];
  const reasons = health.extensions
    .filter((ext) => UNSETTLED.includes(ext.state))
    .map((ext) => `${ext.id} is ${ext.state}`);
  if (health.unsynced?.length)
    reasons.push(`a change of ${health.unsynced.join(', ')} was not undone: its files disagree`);
  if (health.installation === 'unreadable')
    reasons.push(`installation.json cannot be read (${health.installationError ?? 'no reason'})`);
  if (health.installation === 'invalid') reasons.push(invalidReason());
  if (health.seal === 'off') reasons.push(health.sealError ?? 'seal off');
  if (reasons.length === 0) reasons.push('the daemon gave no reason');
  return reasons;
};

const pendingLine = ({ op, id, source, since, timedOut }: PendingChange): string => {
  const late = timedOut ? ', the daemon stopped waiting; it still runs' : '';
  return `  pending ${op} ${id ?? source ?? ''} since ${since}${late}`;
};

// parts, seal and restarts when the daemon reports them (kit 0.15).
const entryLine = ({ id, version, state, parts, seal, restarts }: HealthEntry): string => {
  const more = [
    // A starting market entry has no parts yet (kit: `parts: []` until its folder is known).
    parts?.length && `parts ${parts.join(', ')}`,
    seal && `seal ${seal}`,
    restarts !== undefined && `restarts ${restarts}`,
  ].filter(Boolean);
  return `  ${id} ${version} ${state}${more.length ? `; ${more.join('; ')}` : ''}`;
};

// An entry with seal off carries the daemon's reason in --json too.
export const withSealError = (health: Health & HealthMarks): Health & HealthMarks => ({
  ...health,
  extensions: health.extensions.map((ext) =>
    ext.seal === 'off' && health.sealError ? { ...ext, sealError: health.sealError } : ext
  ),
});

// C2: the one line install prints when the daemon runs its children with no seal.
export const sealOffLine = async (port: number, look = probe): Promise<string | null> => {
  const found = await look(port);
  if (found.kind !== 'ours') return null;
  const { seal, sealError } = found.health as Health & HealthMarks;
  return seal === 'off' ? (sealError ?? 'seal off') : null;
};

// The lines under the first one of `daemon status`.
export const healthLines = (health: Health & HealthMarks, reasons: string[]): string[] => [
  ...health.extensions.map(entryLine),
  ...(health.pending ?? []).map(pendingLine),
  ...reasons.map((reason) => `  degraded: ${reason}`),
];
