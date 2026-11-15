import { createServer, type RequestListener, type Server } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { waitFor } from '../../lib/wait.js';

// D7: a local up takes the first free port from here; the daemon keeps 4243.
export const UP_FROM = 4244;
// The kit's own folder in a working copy (`.agentage/`, ignored by the template).
const LOCAL = '.agentage';

export interface UpRecord {
  pid: number;
  port: number;
  id: string;
  instance: string;
}

export const recordPath = (dir: string): string => join(resolve(dir), LOCAL, 'up.json');
export const dataDirOf = (dir: string): string => join(resolve(dir), LOCAL, 'data');

const isUpRecord = (value: unknown): value is UpRecord =>
  isRecord(value) &&
  Number.isInteger(value['pid']) &&
  Number.isInteger(value['port']) &&
  typeof value['id'] === 'string' &&
  typeof value['instance'] === 'string';

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
  writeJsonAtomic(recordPath(dir), record);
};

export const removeRecord = (dir: string): void => rmSync(recordPath(dir), { force: true });

const bind = (handler: RequestListener, port: number): Promise<Server | null> =>
  new Promise((done, fail) => {
    const server = createServer(handler);
    server.once('error', (err: NodeJS.ErrnoException) =>
      err.code === 'EADDRINUSE' ? done(null) : fail(err)
    );
    server.listen(port, '127.0.0.1', () => done(server));
  });

// D7: the first port from 4244 that binds; a port taken meanwhile is skipped, not fatal.
export const listenFrom = async (handler: RequestListener, from = UP_FROM): Promise<Server> => {
  for (let port = from; port < from + 100; port += 1) {
    const server = await bind(handler, port);
    if (server) return server;
  }
  throw new CliError('port_in_use', `no free port from ${from} to ${from + 99}`);
};

export const portOf = (server: Server): number => (server.address() as { port: number }).port;

export type Answer = 'ours' | 'other' | 'none';

// The record's extension answers on its port when /health names the same id and instance.
export const answerOf = async (record: UpRecord, timeoutMs = 2_000): Promise<Answer> => {
  const res = await fetch(`http://127.0.0.1:${record.port}/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!res) return 'none';
  const body = (await res.json().catch(() => null)) as {
    data?: { extension?: string; instance?: string };
  } | null;
  const same = body?.data?.extension === record.id && body.data.instance === record.instance;
  return same ? 'ours' : 'other';
};

// Resolves on the first SIGINT or SIGTERM, then releases both.
export const untilSignal = (): Promise<string> =>
  new Promise((done) => {
    const on = (signal: string) => {
      process.off('SIGINT', on);
      process.off('SIGTERM', on);
      done(signal);
    };
    process.once('SIGINT', on);
    process.once('SIGTERM', on);
  });

const gone = (record: UpRecord, timeoutMs: number): Promise<boolean> =>
  waitFor(async () => (await answerOf(record, 500)) === 'none', timeoutMs);

export type LocalDown = 'stopped' | 'stale' | 'none';

// Signals the recorded pid only when its port answers as that extension; else the record is stale.
export const stopLocal = async (dir: string, timeoutMs = 10_000): Promise<LocalDown> => {
  const record = readRecord(dir);
  if (!record) return 'none';
  if ((await answerOf(record)) !== 'ours') return (removeRecord(dir), 'stale');
  try {
    process.kill(record.pid, 'SIGTERM');
  } catch (err) {
    const why = messageOf(err);
    throw new CliError('stop_failed', `cannot stop extension up (pid ${record.pid}): ${why}`);
  }
  if (!(await gone(record, timeoutMs)))
    throw new CliError('stop_failed', `extension up (pid ${record.pid}) did not stop`);
  removeRecord(dir);
  return 'stopped';
};
