import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isAlive, isPid } from '../../lib/daemon/daemon-file.js';
import { isRecord, readJson, writeTextAtomic } from '../../lib/fs/json-file.js';
import { CliError } from '../../lib/json-output.js';
import { waitFor } from '../../lib/wait.js';

// The kit's own folder in a working copy (`.agentage/`, ignored by the template).
const LOCAL = '.agentage';

// D12: the up of a folder; `added`: up added the daemon row, so down removes it (never another).
export interface UpRecord {
  pid: number;
  id: string;
  added: boolean;
}

export const recordPath = (dir: string): string => join(resolve(dir), LOCAL, 'up.json');

const isUpRecord = (value: unknown): value is UpRecord =>
  isRecord(value) &&
  isPid(value['pid']) &&
  typeof value['id'] === 'string' &&
  typeof value['added'] === 'boolean';

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

// A live up of the folder is refused; a record of an up that ended keeps only its `added`.
export const refuseRunning = (dir: string): UpRecord | null => {
  const record = readRecord(dir);
  if (!record || !isAlive(record.pid) || record.pid === process.pid) return record;
  throw new CliError(
    'already_running',
    `extension up runs for ${dir} (pid ${record.pid}): agentage extension down`
  );
};

// up ends on Ctrl-C or SIGTERM (the row stays), or when down removes its record (`down`).
export const untilStopped = (dir: string, everyMs = 300): Promise<string> =>
  new Promise((done) => {
    const finish = (why: string): void => {
      clearInterval(timer);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      done(why);
    };
    const onInt = (): void => finish('SIGINT');
    const onTerm = (): void => finish('SIGTERM');
    const timer = setInterval(() => existsSync(recordPath(dir)) || finish('down'), everyMs);
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
  });

export type LocalDown = 'stopped' | 'stale' | 'none';

// Removing the record is the stop: the up of that pid sees it and exits; no pid is signalled.
export const stopLocal = async (
  dir: string,
  timeoutMs = 10_000
): Promise<{ down: LocalDown; record: UpRecord | null }> => {
  const record = readRecord(dir);
  if (!record) return { down: 'none', record };
  removeRecord(dir);
  if (!isAlive(record.pid)) return { down: 'stale', record };
  if (!(await waitFor(() => !isAlive(record.pid), timeoutMs)))
    throw new CliError('stop_failed', `extension up (pid ${record.pid}) did not stop`);
  return { down: 'stopped', record };
};
