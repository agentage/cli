import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, freePort, type CliMachine } from './helpers.js';

// M4 git sync @p0: a vault with an external git origin syncs to a temp bare remote on disk. Fully
// self-contained - a local `git init --bare`, an isolated config dir, and an ephemeral daemon
// port; never the real ~/.agentage, never :4243, no deployed stack. Proves: the daemon auto-loop
// pushes a write within one interval; divergence keeps both sides (.conflict.md, zero loss); an
// unreachable remote never blocks a write.

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'e2e',
  GIT_AUTHOR_EMAIL: 'e2e@example.com',
  GIT_COMMITTER_NAME: 'e2e',
  GIT_COMMITTER_EMAIL: 'e2e@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    // Capture stderr instead of inheriting it, so a probe miss (e.g. cat-file before the first
    // push) does not spam the test log.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV },
  });

// Write vaults.json directly into the isolated config dir for full control over path + origin +
// interval (the CLI `vault add --git` would default the path into the real home).
const writeVaultsConfig = (m: CliMachine, vault: string, path: string, origin: object): void => {
  const config = {
    version: 1,
    default: vault,
    vaults: { [vault]: { path, mcp: ['local'], origin: [origin] } },
  };
  writeFileSync(join(m.configDir, 'vaults.json'), JSON.stringify(config, null, 2), 'utf-8');
};

const bareHas = (bare: string, ref: string): boolean => {
  try {
    git(bare, ['cat-file', '-e', ref]);
    return true;
  } catch {
    return false;
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test.describe('git sync @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('the daemon auto-loop pushes a write to the bare remote within one interval', async () => {
    const port = await freePort();
    const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
    const scratch = mkdtempSync(join(tmpdir(), 'agentage-sync-a-'));
    const bare = join(scratch, 'remote.git');
    const vaultDir = join(scratch, 'vault');
    let daemonPid: number | null = null;
    try {
      git(scratch, ['init', '--bare', '-b', 'main', bare]);
      writeVaultsConfig(m, 'main', vaultDir, { remote: bare, interval: 1 });

      const start = await m.exec(['daemon', 'start']);
      expect(start.code, start.stderr).toBe(0);
      const pidFile = join(m.configDir, 'daemon.pid');
      daemonPid = existsSync(pidFile)
        ? Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
        : null;

      const write = await m.exec(['memory', 'write', 'notes/hi.md', '--body', 'sync me quokka']);
      expect(write.code, write.stderr).toBe(0);

      // The 1s auto-loop should push well within this window.
      const deadline = Date.now() + 30_000;
      while (!bareHas(bare, 'main') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(bareHas(bare, 'main'), 'bare remote received the commit').toBe(true);
      expect(git(bare, ['show', 'main:notes/hi.md'])).toContain('sync me quokka');

      const status = await m.exec(['daemon', 'status']);
      expect(status.stdout).toContain('sync');

      await m.exec(['daemon', 'stop']);
    } finally {
      if (daemonPid !== null && alive(daemonPid)) {
        try {
          process.kill(daemonPid, 'SIGKILL');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
        }
      }
      m.cleanup();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('divergence keeps both sides: <file>.conflict.md holds the remote copy, zero lost writes', async () => {
    // interval 0 (manual-only) + helpers default the daemon off -> a fully in-process forced sync.
    const m = createCliMachine();
    const scratch = mkdtempSync(join(tmpdir(), 'agentage-sync-b-'));
    const bare = join(scratch, 'remote.git');
    const vaultDir = join(scratch, 'vault');
    try {
      git(scratch, ['init', '--bare', '-b', 'main', bare]);
      writeVaultsConfig(m, 'main', vaultDir, { remote: bare, interval: 0 });

      // Seed a base note and push it to the bare remote.
      expect((await m.exec(['memory', 'write', 'note.md', '--body', 'base'])).code).toBe(0);
      expect((await m.exec(['vault', 'sync', 'main'])).code).toBe(0);

      // A second clone advances the remote with a conflicting change.
      const clone = join(scratch, 'clone');
      git(scratch, ['clone', bare, clone]);
      writeFileSync(join(clone, 'note.md'), 'REMOTE-CHANGE\n', 'utf-8');
      git(clone, ['commit', '-am', 'remote change']);
      git(clone, ['push', 'origin', 'HEAD:main']);

      // Local makes its own conflicting change, then forces a sync.
      expect((await m.exec(['memory', 'write', 'note.md', '--body', 'LOCAL-CHANGE'])).code).toBe(0);
      const sync = await m.exec(['vault', 'sync', 'main']);
      expect(sync.code, sync.stderr).toBe(0);
      expect(sync.stdout).toContain('conflict copy');

      expect(readFileSync(join(vaultDir, 'note.md'), 'utf-8')).toContain('LOCAL-CHANGE');
      expect(readFileSync(join(vaultDir, 'note.conflict.md'), 'utf-8')).toContain('REMOTE-CHANGE');
      // The push landed - both sides live on the remote too.
      expect(git(bare, ['show', 'main:note.md'])).toContain('LOCAL-CHANGE');
      expect(git(bare, ['show', 'main:note.conflict.md'])).toContain('REMOTE-CHANGE');
    } finally {
      m.cleanup();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('an unreachable remote never blocks a write; the sync error is recorded, not a crash', async () => {
    const m = createCliMachine();
    const scratch = mkdtempSync(join(tmpdir(), 'agentage-sync-c-'));
    const vaultDir = join(scratch, 'vault');
    try {
      writeVaultsConfig(m, 'main', vaultDir, { remote: join(scratch, 'nope.git'), interval: 0 });

      // The write succeeds even though the remote is unreachable.
      const write = await m.exec(['memory', 'write', 'note.md', '--body', 'offline write']);
      expect(write.code, write.stderr).toBe(0);

      const sync = await m.exec(['vault', 'sync', 'main']);
      expect(sync.code, sync.stderr).toBe(0); // recorded, not a crash
      expect(sync.stdout).toContain('unreachable');
      // The local commit persisted - CRUD never blocks on sync.
      const log = git(vaultDir, ['log', '--oneline']);
      expect(log.trim().length).toBeGreaterThan(0);
    } finally {
      m.cleanup();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
