import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMark, proven, stopProven, type ProcessMark } from '../../lib/proc/start-time.js';
import { isRecord, readJson, writeTextAtomic } from '../../lib/fs/json-file.js';
import { CliError } from '../../lib/json-output.js';
import { waitFor } from '../../lib/wait.js';

// The kit's own folder in a working copy (`.agentage/`, ignored by the template).
const LOCAL = '.agentage';

// D12: marks prove the process (a reused pid is not it); `added`: down may remove the row.
export interface UpRecord {
  up: ProcessMark;
  nonce: string;
  id: string;
  added: boolean;
  tsc?: ProcessMark;
}

export const recordPath = (dir: string): string => join(resolve(dir), LOCAL, 'up.json');

const isUpRecord = (value: unknown): value is UpRecord =>
  isRecord(value) &&
  isMark(value['up']) &&
  typeof value['nonce'] === 'string' &&
  typeof value['id'] === 'string' &&
  typeof value['added'] === 'boolean' &&
  (value['tsc'] === undefined || isMark(value['tsc']));

export const readRecord = (dir: string): UpRecord | null => readJson(recordPath(dir), isUpRecord);

// The run state stays out of git: `.agentage/` goes into the folder's .gitignore when missing.
export const ignoreLocal = (dir: string): void => {
  if (!existsSync(resolve(dir))) return;
  const file = join(resolve(dir), '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((line) => /^\/?\.agentage\/?$/.test(line.trim()))) return;
  appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${LOCAL}/\n`);
  console.error(`gitignore added ${LOCAL}/ to ${file}`);
};

export const writeRecord = (dir: string, record: UpRecord): void => {
  mkdirSync(join(resolve(dir), LOCAL), { recursive: true });
  ignoreLocal(dir);
  writeTextAtomic(recordPath(dir), `${JSON.stringify(record)}\n`);
};

export const removeRecord = (dir: string): void => rmSync(recordPath(dir), { force: true });

// A tsc that outlived its up (killed hard): stopped only when proven to be that tsc.
export const stopOrphan = (record: UpRecord | null): void => {
  if (!record?.tsc || proven(record.up)) return;
  if (stopProven(record.tsc))
    console.error(`stopped   the tsc watch (pid ${record.tsc.pid}) of an up that ended`);
};

// A live up of the folder is refused; a record of an up that ended keeps only its `added`.
export const refuseRunning = (dir: string): UpRecord | null => {
  const record = readRecord(dir);
  if (!record || !proven(record.up) || record.up.pid === process.pid)
    return (stopOrphan(record), record);
  throw new CliError(
    'already_running',
    `extension up runs for ${dir} (pid ${record.up.pid}): agentage extension down`
  );
};

// A closed terminal (SIGHUP) stops as Ctrl-C does: the watch goes, the row stays for the next up.
const STOPS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// Ends on a signal (the row stays), a removed or rewritten record (`down`) or a dead watch.
export const untilStopped = (
  dir: string,
  nonce: string,
  ended: Promise<string>,
  everyMs = 300
): Promise<string> =>
  new Promise((done) => {
    const on = STOPS.map((name) => [name, () => finish(name)] as const);
    const finish = (why: string): void => {
      clearInterval(timer);
      for (const [name, handler] of on) process.off(name, handler);
      done(why);
    };
    const timer = setInterval(() => readRecord(dir)?.nonce === nonce || finish('down'), everyMs);
    for (const [name, handler] of on) process.once(name, handler);
    void ended.then(finish);
  });

export type LocalDown = 'stopped' | 'stale' | 'none';

// Removing the record is the stop: the up of that pid sees it and exits; no up is signalled.
export const stopLocal = async (
  dir: string,
  timeoutMs = 10_000
): Promise<{ down: LocalDown; record: UpRecord | null }> => {
  const record = readRecord(dir);
  if (!record) return { down: 'none', record };
  removeRecord(dir);
  if (!proven(record.up)) return (stopOrphan(record), { down: 'stale', record });
  if (!(await waitFor(() => !proven(record.up), timeoutMs)))
    throw new CliError('stop_failed', `extension up (pid ${record.up.pid}) did not stop`);
  stopOrphan(record);
  return { down: 'stopped', record };
};
