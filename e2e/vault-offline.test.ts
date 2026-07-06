import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// The offline registry on the unified vaults.json: add/list/remove work with no network. @p0
test.describe('offline vault registry @p0', () => {
  test.beforeAll(() => assertCliBuilt());

  test('add --local -> list -> remove round-trips with no network', async () => {
    const machine = createCliMachine();
    try {
      const path = join(machine.configDir, 'scratch');
      const added = await machine.exec(['vault', 'add', 'scratch', '--local', path]);
      expect(added.code, added.stderr).toBe(0);

      const listed = await machine.exec(['vault', 'list', '--json']);
      expect(listed.code, listed.stderr).toBe(0);
      const vaults = JSON.parse(listed.stdout) as Record<string, { path?: string }>;
      expect(Object.keys(vaults)).toEqual(['scratch']);
      expect(vaults.scratch!.path).toBe(path);

      const removed = await machine.exec(['vault', 'remove', 'scratch']);
      expect(removed.code, removed.stderr).toBe(0);

      const after = await machine.exec(['vault', 'list', '--json']);
      expect(Object.keys(JSON.parse(after.stdout))).toHaveLength(0);
    } finally {
      machine.cleanup();
    }
  });

  test('vault add without --local/--git fails clearly', async () => {
    const machine = createCliMachine();
    try {
      const res = await machine.exec(['vault', 'add', 'acct']);
      expect(res.code).not.toBe(0);
      expect(res.stderr + res.stdout).toMatch(/--local|--git/);
    } finally {
      machine.cleanup();
    }
  });
});
