import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type ExtensionLog } from '../../extension.js';
import { writeTextAtomic } from '../../lib/fs/json-file.js';
import { logsDir } from '../paths.js';

export const LOG_CAP_BYTES = 1024 * 1024;

// Past the cap, keep the newest half from its first whole line, so the file stays small.
const trim = (path: string): void => {
  if (statSync(path).size <= LOG_CAP_BYTES) return;
  const tail = readFileSync(path)
    .subarray(-LOG_CAP_BYTES / 2)
    .toString('utf-8');
  writeTextAtomic(path, tail.slice(tail.indexOf('\n') + 1));
};

// The extension's own log; the core never reads it, its run state lives in state/<id>.json.
export const extensionLog =
  (id: string): ExtensionLog =>
  (message, fields = {}) => {
    const path = join(logsDir(), `${id}.log`);
    mkdirSync(logsDir(), { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ at: new Date().toISOString(), message, ...fields });
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
    trim(path);
  };
