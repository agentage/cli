import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// Hardening tier: drives the built CLI against a temp config dir to cover every M1
// acceptance criterion end to end. All offline except `update --check` (which the
// verb tolerates on any network state). @p0
const SCHEMA_URL = 'https://agentage.io/schemas/vaults.schema.json';

test.describe('M1 config + vault registry (offline) @p0', () => {
  test.beforeAll(() => assertCliBuilt());

  test('add --git writes a valid git entry with the interval + $schema', async () => {
    const machine = createCliMachine();
    try {
      const path = join(machine.configDir, 'work');
      const res = await machine.exec([
        'vault',
        'add',
        'work',
        '--git',
        'git@github.com:me/w.git',
        '--path',
        path,
        '--interval',
        '10m',
      ]);
      expect(res.code, res.stderr).toBe(0);
      const cfg = JSON.parse(readFileSync(join(machine.configDir, 'vaults.json'), 'utf-8'));
      expect(cfg.$schema).toBe(SCHEMA_URL);
      expect(cfg.vaults[0]).toMatchObject({
        name: 'work',
        type: 'git',
        remote: 'git@github.com:me/w.git',
        sync: { interval: '10m' },
      });
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
      await machine.exec(['vault', 'add', 'a', '--local', '--path', join(machine.configDir, 'a')]);
      const res = await machine.exec([
        'vault',
        'add',
        'a',
        '--local',
        '--path',
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
        '--path',
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
      await machine.exec(['vault', 'add', 'v', '--local', '--path', join(machine.configDir, 'v')]);
      const rm = await machine.exec(['vault', 'remove', 'v']);
      expect(rm.code, rm.stderr).toBe(0);
      const cfg = JSON.parse(readFileSync(join(machine.configDir, 'vaults.json'), 'utf-8'));
      expect(cfg).toMatchObject({ $schema: SCHEMA_URL, vaults: [] });
    } finally {
      machine.cleanup();
    }
  });

  test('remove keeps the markdown on disk and drops the index db', async () => {
    const machine = createCliMachine();
    try {
      const vaultDir = join(machine.configDir, 'notes');
      await machine.exec(['vault', 'add', 'notes', '--local', '--path', vaultDir]);
      writeFileSync(join(vaultDir, 'note.md'), '# keep me');
      const indexDir = join(machine.configDir, 'index');
      mkdirSync(indexDir, { recursive: true });
      writeFileSync(join(indexDir, 'notes.db'), 'x');

      const rm = await machine.exec(['vault', 'remove', 'notes']);
      expect(rm.code, rm.stderr).toBe(0);
      expect(existsSync(join(vaultDir, 'note.md'))).toBe(true);
      expect(existsSync(join(indexDir, 'notes.db'))).toBe(false);
    } finally {
      machine.cleanup();
    }
  });

  test('accepts a hand-written vaults.yaml, and JSON wins when both exist', async () => {
    const machine = createCliMachine();
    try {
      writeFileSync(
        join(machine.configDir, 'vaults.yaml'),
        'version: 1\nvaults:\n  - name: fromyaml\n    type: local\n    path: ~/y\n'
      );
      const yamlList = await machine.exec(['vault', 'list', '--json']);
      expect(yamlList.code, yamlList.stderr).toBe(0);
      expect(JSON.parse(yamlList.stdout)[0]).toMatchObject({ name: 'fromyaml' });

      writeFileSync(
        join(machine.configDir, 'vaults.json'),
        JSON.stringify({ version: 1, vaults: [{ name: 'fromjson', type: 'local', path: '~/j' }] })
      );
      const jsonList = await machine.exec(['vault', 'list', '--json']);
      expect(JSON.parse(jsonList.stdout)[0]).toMatchObject({ name: 'fromjson' });
    } finally {
      machine.cleanup();
    }
  });

  test('a malformed config (unknown type) fails loudly', async () => {
    const machine = createCliMachine();
    try {
      writeFileSync(
        join(machine.configDir, 'vaults.json'),
        JSON.stringify({ version: 1, vaults: [{ name: 'x', type: 'ftp' }] })
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
