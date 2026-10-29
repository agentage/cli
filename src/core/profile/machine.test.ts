import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMachine, parseMachine, type MachineDeps } from './machine.js';

const OLD_ID = '260d7044-b229-4afb-bbf3-40af745c3926';
const FRESH = { id: 'm_0123abcd', name: 'box', dev: {}, profileSource: 'default' };

const fakeDeps = (raw: unknown): MachineDeps & { write: ReturnType<typeof vi.fn> } => {
  let stored = raw;
  return {
    path: () => '/cfg/machine.json',
    read: () => stored,
    write: vi.fn((_path: string, machine: unknown) => {
      stored = JSON.parse(JSON.stringify(machine));
    }),
    lock: (_path, fn) => Promise.resolve(fn()),
    hostname: () => 'box',
    newId: () => 'm_0123abcd',
  };
};

describe('machine.json', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-machine-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a 0600 machine.json with an m_ + 8 hex id on first run', async () => {
    const machine = await loadMachine();
    expect(machine.id).toMatch(/^m_[0-9a-f]{8}$/);
    expect(machine).toMatchObject({ dev: {}, profileSource: 'default' });
    expect(machine.name.length).toBeGreaterThan(0);
    const path = join(dir, 'cfg', 'machine.json');
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(machine);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, 'cfg'))).toEqual(['machine.json']);
  });

  it('replaces a file from an older CLI instead of migrating it (T35)', async () => {
    const path = join(dir, 'cfg', 'machine.json');
    await loadMachine();
    writeFileSync(path, JSON.stringify({ id: OLD_ID, name: 'old-host' }), { mode: 0o644 });
    const machine = await loadMachine();
    expect(machine.id).toMatch(/^m_[0-9a-f]{8}$/);
    expect(machine.name).not.toBe('old-host');
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(machine);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('is stable: a complete file is read, never rewritten', async () => {
    const deps = fakeDeps({
      id: 'm_1a2b3c4d',
      name: 'n',
      dev: { '@a/b': '/x' },
      profileSource: 'file',
    });
    expect(await loadMachine(deps)).toEqual({
      id: 'm_1a2b3c4d',
      name: 'n',
      dev: { '@a/b': '/x' },
      profileSource: 'file',
    });
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('replaces a malformed file with a fresh one', async () => {
    const deps = fakeDeps({ id: 'm_1a2b3c4d', name: 3, dev: {}, profileSource: 'x' });
    expect(await loadMachine(deps)).toEqual(FRESH);
    expect(deps.write).toHaveBeenCalledTimes(1);
  });

  it('adopts the id another process wrote while this one waited on the lock', async () => {
    const deps = fakeDeps(null);
    const winner = { id: 'm_aaaaaaaa', name: 'w', dev: {}, profileSource: 'default' };
    deps.read = vi.fn().mockReturnValueOnce(null).mockReturnValue(winner);
    expect(await loadMachine(deps)).toEqual(winner);
    expect(deps.write).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-object', [1]],
    ['a legacy uuid id', { id: OLD_ID, name: 'n', dev: {}, profileSource: 'default' }],
    ['an empty name', { ...FRESH, name: '' }],
    ['a non-string dev path', { ...FRESH, dev: { x: 1 } }],
    ['an unknown profileSource', { ...FRESH, profileSource: 'remote' }],
    ['an extra key', { ...FRESH, extra: true }],
    ['a missing key', { id: 'm_0123abcd', name: 'box', dev: {} }],
  ])('rejects %s', (_label, raw) => {
    expect(parseMachine(raw)).toBeNull();
  });
});
