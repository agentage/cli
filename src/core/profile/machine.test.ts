import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMachine, normalizeMachine, type MachineDeps } from './machine.js';

const LEGACY_ID = '260d7044-b229-4afb-bbf3-40af745c3926';

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

  it('keeps a legacy id and name, adding dev and profileSource (T35)', async () => {
    const path = join(dir, 'cfg', 'machine.json');
    await loadMachine();
    writeFileSync(path, JSON.stringify({ id: LEGACY_ID, name: 'legacy-host' }), { mode: 0o644 });
    const machine = await loadMachine();
    expect(machine).toEqual({
      id: LEGACY_ID,
      name: 'legacy-host',
      dev: {},
      profileSource: 'default',
    });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(machine);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('is stable: a complete file is read, never rewritten', async () => {
    const deps = fakeDeps({ id: 'm_1', name: 'n', dev: { '@a/b': '/x' }, profileSource: 'file' });
    expect(await loadMachine(deps)).toEqual({
      id: 'm_1',
      name: 'n',
      dev: { '@a/b': '/x' },
      profileSource: 'file',
    });
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('repairs a malformed file and keeps keys a newer CLI added', async () => {
    const deps = fakeDeps({ id: '', name: 3, dev: { ok: '/p', bad: 1 }, profileSource: 'x', v: 2 });
    const machine = await loadMachine(deps);
    expect(machine).toEqual({
      id: 'm_0123abcd',
      name: 'box',
      dev: { ok: '/p' },
      profileSource: 'default',
      v: 2,
    });
    expect(deps.write).toHaveBeenCalledTimes(1);
  });

  it('adopts the id another process wrote while this one waited on the lock', async () => {
    const deps = fakeDeps(null);
    const winner = { id: 'm_aaaaaaaa', name: 'w', dev: {}, profileSource: 'default' };
    deps.read = vi.fn().mockReturnValueOnce(null).mockReturnValue(winner);
    expect(await loadMachine(deps)).toEqual(winner);
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('treats a non-object as absent', () => {
    expect(normalizeMachine([1], fakeDeps(null))).toEqual({
      id: 'm_0123abcd',
      name: 'box',
      dev: {},
      profileSource: 'default',
    });
  });
});
