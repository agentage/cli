import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// Hardening tier: drives the built CLI against a temp config dir to cover the config +
// registry acceptance criteria end to end. All offline except `update --check`. @p0
const SCHEMA_URL = 'https://agentage.io/schemas/vaults.schema.json';

test.describe('config + vault registry (offline) @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('add --git writes a valid origin entry with the $schema link', async () => {
    const machine = createCliMachine();
    try {
      const res = await machine.exec(['vault', 'add', 'work', '--git', 'git@github.com:me/w.git']);
      expect(res.code, res.stderr).toBe(0);
      const cfg = JSON.parse(readFileSync(join(machine.configDir, 'vaults.json'), 'utf-8'));
      expect(cfg.$schema).toBe(SCHEMA_URL);
      expect(cfg.default).toBe('work');
      expect(cfg.vaults.work.origin[0].remote).toBe('git@github.com:me/w.git');
    } finally {
      machine.cleanup();
    }
  });

  test('--git requires a remote value', async () => {
    const machine = createCliMachine();
    try {
      const res = await machine.exec(['vault', 'add', 'work', '--git']);
      expect(res.code).not.toBe(0);
    } finally {
      machine.cleanup();
    }
  });

  test('a duplicate vault name is rejected', async () => {
    const machine = createCliMachine();
    try {
      await machine.exec(['vault', 'add', 'a', '--local', join(machine.configDir, 'a')]);
      const res = await machine.exec([
        'vault',
        'add',
        'a',
        '--local',
        join(machine.configDir, 'a2'),
      ]);
      expect(res.code).not.toBe(0);
      expect(res.stderr + res.stdout).toContain('already exists');
    } finally {
      machine.cleanup();
    }
  });

  test('a name that breaks the cloud-path allowlist is rejected', async () => {
    const machine = createCliMachine();
    try {
      const res = await machine.exec([
        'vault',
        'add',
        'bad name',
        '--local',
        join(machine.configDir, 'x'),
      ]);
      expect(res.code).not.toBe(0);
    } finally {
      machine.cleanup();
    }
  });

  test('an empty vaults.json still carries the $schema link', async () => {
    const machine = createCliMachine();
    try {
      await machine.exec(['vault', 'add', 'v', '--local', join(machine.configDir, 'v')]);
      const rm = await machine.exec(['vault', 'remove', 'v']);
      expect(rm.code, rm.stderr).toBe(0);
      const cfg = JSON.parse(readFileSync(join(machine.configDir, 'vaults.json'), 'utf-8'));
      expect(cfg.$schema).toBe(SCHEMA_URL);
      expect(Object.keys(cfg.vaults)).toHaveLength(0);
    } finally {
      machine.cleanup();
    }
  });

  test('remove keeps the markdown on disk', async () => {
    const machine = createCliMachine();
    try {
      const vaultDir = join(machine.configDir, 'notes');
      await machine.exec(['vault', 'add', 'notes', '--local', vaultDir]);
      writeFileSync(join(vaultDir, 'note.md'), '# keep me');
      const rm = await machine.exec(['vault', 'remove', 'notes']);
      expect(rm.code, rm.stderr).toBe(0);
      expect(existsSync(join(vaultDir, 'note.md'))).toBe(true);
    } finally {
      machine.cleanup();
    }
  });

  test('a malformed config (entry with no path or origin) fails loudly', async () => {
    const machine = createCliMachine();
    try {
      writeFileSync(
        join(machine.configDir, 'vaults.json'),
        JSON.stringify({ version: 1, vaults: { x: {} } })
      );
      const res = await machine.exec(['vault', 'list']);
      expect(res.code).not.toBe(0);
    } finally {
      machine.cleanup();
    }
  });

  test('update --check reports a verdict and exits 0 without installing', async () => {
    const machine = createCliMachine();
    try {
      const res = await machine.exec(['update', '--check']);
      expect(res.code, res.stderr).toBe(0);
      expect(res.stdout.trim().length).toBeGreaterThan(0);
    } finally {
      machine.cleanup();
    }
  });
});
