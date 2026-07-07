import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// Account vaults (agentage channel) are offline-first: a no-flag `vault add` writes the local
// entry and mirror dir with zero network, provisioning the cloud channel only when signed in.
// Egress is blackholed via unroutable proxies to prove the offline path never reaches out. @p0
const BLACKHOLE = 'http://127.0.0.1:1';
const OFFLINE = {
  http_proxy: BLACKHOLE,
  https_proxy: BLACKHOLE,
  HTTP_PROXY: BLACKHOLE,
  HTTPS_PROXY: BLACKHOLE,
};

interface AccountEntry {
  path?: string;
  origin?: { remote: string }[];
  type?: string;
}

test.describe('account vault (offline) @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('no-flag add registers an account vault locally, then reads/writes it, with no network', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      // --path keeps the mirror inside the isolated config dir (default would be the real ~/vaults).
      const vaultDir = join(m.configDir, 'acct');
      const add = await m.exec(['vault', 'add', 'acct', '--path', vaultDir]);
      expect(add.code, add.stderr).toBe(0);
      // Not signed in and offline: the entry is kept locally with a setup hint, never a crash.
      expect(add.stdout).toContain('(account)');
      expect(add.stdout).toContain('registered locally');

      // The entry carries the agentage origin, and the mirror dir was created.
      const cfg = JSON.parse(readFileSync(join(m.configDir, 'vaults.json'), 'utf-8')) as {
        default: string;
        vaults: Record<string, AccountEntry>;
      };
      expect(cfg.default).toBe('acct');
      expect(cfg.vaults.acct!.origin?.[0]?.remote).toBe('agentage');
      expect(cfg.vaults.acct!.path).toBe(vaultDir);
      expect(existsSync(vaultDir)).toBe(true);

      // Memory verbs work against it immediately (local git backend, still no network).
      const write = await m.exec(['memory', 'write', 'notes/a.md', '--body', 'account vault note']);
      expect(write.code, write.stderr).toBe(0);
      const read = await m.exec(['memory', 'read', 'notes/a.md']);
      expect(read.code, read.stderr).toBe(0);
      expect(read.stdout).toContain('account vault note');
    } finally {
      m.cleanup();
    }
  });

  test('vault list renders an account vault as type "account"', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'acct');
      expect((await m.exec(['vault', 'add', 'acct', '--path', vaultDir])).code).toBe(0);

      const listed = await m.exec(['vault', 'list', '--json']);
      expect(listed.code, listed.stderr).toBe(0);
      const vaults = JSON.parse(listed.stdout) as Record<string, AccountEntry>;
      expect(vaults.acct!.type).toBe('account');
      // Backward-compatible: the entry still carries its path.
      expect(vaults.acct!.path).toBe(vaultDir);

      const human = await m.exec(['vault', 'list']);
      expect(human.stdout).toContain('account');
    } finally {
      m.cleanup();
    }
  });

  test('vault remove unregisters an account vault but leaves its files on disk', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'acct');
      expect((await m.exec(['vault', 'add', 'acct', '--path', vaultDir])).code).toBe(0);
      expect((await m.exec(['memory', 'write', 'keep.md', '--body', 'keep me'])).code).toBe(0);

      const removed = await m.exec(['vault', 'remove', 'acct']);
      expect(removed.code, removed.stderr).toBe(0);
      expect(removed.stdout).toContain('files left on disk');

      // The registry entry is gone but the markdown stays.
      const after = await m.exec(['vault', 'list', '--json']);
      expect(Object.keys(JSON.parse(after.stdout))).toHaveLength(0);
      expect(existsSync(join(vaultDir, 'keep.md'))).toBe(true);
    } finally {
      m.cleanup();
    }
  });

  test('vault sync on an offline, signed-out account vault pauses instead of erroring', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'acct');
      expect((await m.exec(['vault', 'add', 'acct', '--path', vaultDir])).code).toBe(0);

      // Not signed in: the couch cycle pauses with zero network, never a crash (exit 0).
      const sync = await m.exec(['vault', 'sync', 'acct']);
      expect(sync.code, sync.stderr).toBe(0);
      expect(sync.stdout).toContain('acct (account)');
      expect(sync.stdout).toContain('paused (signed out)');
    } finally {
      m.cleanup();
    }
  });
});
