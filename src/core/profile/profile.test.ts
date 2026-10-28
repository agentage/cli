import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProfile } from './profile.js';

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
