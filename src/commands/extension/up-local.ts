import { createServer as netServer } from 'node:net';
import { type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HostedExtension } from '@agentage/extension/host';
import { CliError } from '../../lib/json-output.js';

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

export const readRecord = (dir: string): UpRecord | null => {
  const file = recordPath(dir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as UpRecord;
  } catch {
    return null;
  }
};

export const writeRecord = (dir: string, record: UpRecord): void => {
  mkdirSync(join(resolve(dir), LOCAL), { recursive: true });
  writeFileSync(recordPath(dir), `${JSON.stringify(record)}\n`, { mode: 0o600 });
};

export const removeRecord = (dir: string): void => rmSync(recordPath(dir), { force: true });

const isFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const probe = netServer().once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });

export const nextFreePort = async (from = UP_FROM): Promise<number> => {
  for (let port = from; port < from + 100; port += 1) if (await isFree(port)) return port;
  throw new CliError('port_in_use', `no free port from ${from} to ${from + 99}`);
};

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

export const listen = (app: HostedExtension['app'], port: number): Promise<Server> =>
  new Promise((done, fail) => {
    const server = app.listen(port, '127.0.0.1', () => done(server));
    server.once('error', fail);
  });

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

const gone = async (record: UpRecord, timeoutMs: number): Promise<boolean> => {
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    if ((await answerOf(record, 500)) === 'none') return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
};

export type LocalDown = 'stopped' | 'stale' | 'none';

// Signals the recorded pid only when its port answers as that extension; else the record is stale.
export const stopLocal = async (dir: string, timeoutMs = 10_000): Promise<LocalDown> => {
  const record = readRecord(dir);
  if (!record) return 'none';
  if ((await answerOf(record)) !== 'ours') return (removeRecord(dir), 'stale');
  process.kill(record.pid, 'SIGTERM');
  if (!(await gone(record, timeoutMs)))
    throw new CliError('stop_failed', `extension up (pid ${record.pid}) did not stop`);
  removeRecord(dir);
  return 'stopped';
};
