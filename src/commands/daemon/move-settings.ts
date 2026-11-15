import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { type Skipped } from './move-plan.js';

type Coerced = { value: unknown } | null;

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

// 0.51 kept any JSON value; the daemon wants the manifest's type, so a value is turned into it.
const coerce = (type: unknown, value: unknown): Coerced => {
  if (type === 'string') return typeof value === 'object' ? null : { value: String(value) };
  if (type === 'boolean') {
    if (typeof value === 'boolean') return { value };
    return value === 'true' || value === 'false' ? { value: value === 'true' } : null;
  }
  const n = typeof value === 'number' ? value : NUMERIC.test(String(value)) ? Number(value) : NaN;
  if (Number.isNaN(n) || typeof value === 'object') return null;
  return type === 'integer' && !Number.isInteger(n) ? null : { value: n };
};

const declared = (dir: string): Record<string, unknown> | null => {
  const agentage = readJson(join(dir, 'package.json'), isRecord)?.['agentage'];
  const settings = isRecord(agentage) ? agentage['settings'] : undefined;
  return isRecord(settings) ? settings : null;
};

const valueOf = (decl: unknown, value: unknown): Coerced => {
  if (!isRecord(decl)) return null;
  const done = coerce(decl['type'], value);
  const allowed = Array.isArray(decl['enum']) ? decl['enum'] : null;
  return done && allowed && !allowed.includes(done.value) ? null : done;
};

// The settings the extension declares, of its types; a key it cannot take is dropped and reported,
// so the extension still starts. No declared settings (an 0.51 extension): kept as they are.
export const movedSettings = (id: string, dir: string, config: Record<string, unknown>) => {
  const decls = declared(dir);
  if (decls === null) return { settings: config, dropped: [] as Skipped[] };
  const settings: Record<string, unknown> = {};
  const dropped: Skipped[] = [];
  for (const [key, value] of Object.entries(config)) {
    const done = valueOf(decls[key], value);
    if (done) settings[key] = done.value;
    else
      dropped.push({
        entry: `${id} setting ${key}`,
        reason: key in decls ? `${JSON.stringify(value)} does not fit its type` : 'not declared',
      });
  }
  return { settings, dropped };
};
