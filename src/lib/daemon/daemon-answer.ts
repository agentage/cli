import { isRecord } from '../fs/json-file.js';
import { DaemonError } from '../json-output.js';

const STATUS = 'agentage daemon status';

// After a 504 the kit records nothing; the npm tree an installer finishes later is reused.
const RECORDED_NOT = `the daemon recorded nothing: when ${STATUS} no longer shows it under pending, run the command again (a download that finished is reused)`;

// A 409 CONFLICT of a timed-out install that still runs names op and since, not an installed entry.
const stillRuns = (details: Record<string, unknown>): boolean =>
  details['timedOut'] === true || typeof details['op'] === 'string';

// One honest tail per answer the kit 0.14 daemon gives; the daemon's code stays the cli's code.
const tailOf = (status: number, code: string, details: Record<string, unknown>): string => {
  if (code === 'CONFLICT' && stillRuns(details))
    return `; ${STATUS} shows it under pending; try again when it ends`;
  if (code === 'INSTALLATION_UNREADABLE') return `; ${STATUS} shows the reason`;
  if (code === 'TIMEOUT') return `; ${RECORDED_NOT}`;
  if (status === 503) return '; try again';
  return '';
};

// The daemon's envelope as a DaemonError: its code, its message with the tail, status and details.
export const daemonFailure = (status: number, body: unknown): DaemonError => {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  const message = typeof error['message'] === 'string' ? error['message'] : `HTTP ${status}`;
  const code = typeof error['code'] === 'string' && error['code'] ? error['code'] : 'error';
  const details = isRecord(error['details']) ? error['details'] : {};
  const tail = message.endsWith('try again') ? '' : tailOf(status, code, details);
  return new DaemonError(code, `${message}${tail}`, status, details);
};

// The entry a 409 CONFLICT of an add names (kit 0.14): its id, version, and folder when not market.
export interface Existing {
  id: string;
  version?: string;
  source?: string;
}

export const existingOf = (err: DaemonError): Existing | null => {
  const { id, version, source } = err.details;
  if (err.code !== 'CONFLICT' || typeof id !== 'string' || stillRuns(err.details)) return null;
  return {
    id,
    ...(typeof version === 'string' && { version }),
    ...(typeof source === 'string' && { source }),
  };
};
