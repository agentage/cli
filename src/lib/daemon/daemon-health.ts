import { type Health } from './daemon-probe.js';

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
}

const UNSETTLED = ['starting', 'failed'];

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
  if (health.installation === 'invalid')
    reasons.push('installation.json had rows it refused: kept as installation.json.bad');
  if (reasons.length === 0) reasons.push('the daemon gave no reason');
  return reasons;
};

const pendingLine = ({ op, id, source, since, timedOut }: PendingChange): string => {
  const late = timedOut ? ', the daemon stopped waiting; it still runs' : '';
  return `  pending ${op} ${id ?? source ?? ''} since ${since}${late}`;
};

// The lines under the first one of `daemon status`.
export const healthLines = (health: Health & HealthMarks, reasons: string[]): string[] => [
  ...health.extensions.map((ext) => `  ${ext.id} ${ext.version} ${ext.state}`),
  ...(health.pending ?? []).map(pendingLine),
  ...reasons.map((reason) => `  degraded: ${reason}`),
];
