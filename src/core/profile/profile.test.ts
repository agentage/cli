import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile } from './default-profile.js';
import { mutateProfile, readProfile } from './profile.js';

describe('readProfile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-profile-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('is null when profile.json is absent', () => {
    expect(readProfile()).toBeNull();
  });

  it('parses profile.json under the config dir', () => {
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ version: 1, plugins: {} }));
    expect(readProfile()).toMatchObject({ ok: true, profile: { version: 1, plugins: {} } });
  });

  it('reports unparsable JSON instead of treating it as absent', () => {
    writeFileSync(join(dir, 'profile.json'), '{ nope');
    expect(readProfile()).toEqual({ ok: false, errors: ['profile.json: not valid JSON'] });
  });

  it('reports an unreadable file as an error', () => {
    mkdirSync(join(dir, 'profile.json'));
    const result = readProfile();
    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.errors[0]).toMatch(/^profile\.json: /);
  });

  it('reports a non-Error throw from injected deps', () => {
    const result = readProfile({
      path: () => 'x',
      readText: () => {
        throw 'denied';
      },
    });
    expect(result).toEqual({ ok: false, errors: ['profile.json: denied'] });
  });
});

describe('mutateProfile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-profile-write-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the default profile as a 0600 v1 document, creating the config dir', async () => {
    const seen: unknown[] = [];
    await mutateProfile((current) => {
      seen.push(current);
      return defaultProfile();
    });
    const path = join(dir, 'cfg', 'profile.json');
    expect(seen).toEqual([null]);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      version: 1,
      plugins: {},
      config: {},
      machines: {},
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('hands the newest local copy to fn and keeps unknown keys on the round trip', async () => {
    mkdirSync(join(dir, 'cfg'));
    const path = join(dir, 'cfg', 'profile.json');
    writeFileSync(path, JSON.stringify({ version: 1, plugins: { '@agentage/a': '^1' }, x: 1 }));
    const next = await mutateProfile((current) => ({
      ...(current ?? defaultProfile()),
      plugins: { ...current?.plugins, '@agentage/b': '^2' },
    }));
    expect(next.plugins).toEqual({ '@agentage/a': '^1', '@agentage/b': '^2' });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toMatchObject({ x: 1 });
  });
});
