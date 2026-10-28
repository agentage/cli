import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRecord, readJson, writeJsonAtomic } from './json-file.js';

const isNamed = (v: unknown): v is { name: string } => isRecord(v) && typeof v['name'] === 'string';

describe('json-file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-json-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a value through an atomic 0600 write', () => {
    const path = join(dir, 'a.json');
    writeJsonAtomic(path, { name: 'x' });
    expect(readJson(path, isNamed)).toEqual({ name: 'x' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf-8').endsWith('\n')).toBe(true);
  });

  it('applies a custom mode before the rename', () => {
    const path = join(dir, 'b.json');
    writeJsonAtomic(path, { name: 'x' }, 0o640);
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  it('returns null for a missing, unparsable or wrong-shaped file', () => {
    const path = join(dir, 'c.json');
    expect(readJson(path, isNamed)).toBeNull();
    writeFileSync(path, 'not json');
    expect(readJson(path, isNamed)).toBeNull();
    for (const body of ['{}', '[]', 'null', '42', '{"name":1}']) {
      writeFileSync(path, body);
      expect(readJson(path, isNamed), body).toBeNull();
    }
  });

  it('leaves no temp file behind when the write fails', () => {
    const path = join(dir, 'taken');
    mkdirSync(path); // a directory at the target makes the rename fail after the temp is written
    writeFileSync(join(path, 'keep'), '');
    expect(() => writeJsonAtomic(path, { name: 'x' })).toThrow();
    expect(readdirSync(dir)).toEqual(['taken']);
  });

  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});
