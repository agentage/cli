import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  assertCliBuilt,
  CLI_BIN,
  createCliMachine,
  type CliMachine,
  type ExecResult,
  freePort,
  TARGET_FQDN,
} from './helpers.js';

// Data-integrity tier: proves the store guarantees the docs claim but no other tier verifies -
// the daemon's single-writer serialization under concurrency, path-traversal rejection, no-op
// write idempotence, stdin round-trip, graceful offline degradation, and non-destructive vault
// removal. All offline: daemon tests speak loopback + local git, the rest use the in-process
// engine with egress blackholed. @p0
const BLACKHOLE = 'http://127.0.0.1:1';
const OFFLINE = {
  http_proxy: BLACKHOLE,
  https_proxy: BLACKHOLE,
  HTTP_PROXY: BLACKHOLE,
  HTTPS_PROXY: BLACKHOLE,
};

const git = (dir: string, args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });

const commitCount = (dir: string): number =>
  Number.parseInt(git(dir, ['rev-list', '--count', 'HEAD']).trim(), 10);

const workingTreeClean = (dir: string): boolean =>
  git(dir, ['status', '--porcelain']).trim() === '';

const hasIndexLock = (dir: string): boolean => existsSync(join(dir, '.git', 'index.lock'));

// A corrupt object DB fails fsck with a non-zero exit; a clean repo returns 0.
const fsckClean = (dir: string): boolean => {
  try {
    execFileSync('git', ['-C', dir, 'fsck', '--full'], { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

const daemonPid = (m: CliMachine): number | null => {
  const p = join(m.configDir, 'daemon.pid');
  return existsSync(p) ? Number.parseInt(readFileSync(p, 'utf-8').trim(), 10) : null;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Pipe a body to the CLI over stdin (helpers.exec can't). Mirrors createCliMachine's env.
const execStdin = (configDir: string, args: string[], stdin: string): Promise<ExecResult> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      env: {
        ...process.env,
        AGENTAGE_CONFIG_DIR: configDir,
        AGENTAGE_SITE_FQDN: TARGET_FQDN,
        NO_COLOR: '1',
        AGENTAGE_NO_DAEMON: '1',
      },
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    child.on('close', (code) => resolve({ stdout: out, stderr: out, code: code ?? 1 }));
    child.stdin.write(stdin);
    child.stdin.end();
  });

test.describe('store data integrity @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('10 concurrent writes serialize into 10 clean commits', async () => {
    const port = await freePort();
    const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
    const vaultDir = join(m.configDir, 'main');
    let pid: number | null = null;
    try {
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);
      expect((await m.exec(['daemon', 'start'])).code).toBe(0);
      pid = daemonPid(m);

      // Ten writes to distinct paths, fired at once; the daemon's single engine serializes them.
      const writes = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          m.exec(['memory', 'write', `notes/n${i}.md`, '--body', `body-${i}`])
        )
      );
      for (const w of writes) expect(w.code, w.stderr).toBe(0);

      const reads = await Promise.all(
        Array.from({ length: 10 }, (_, i) => m.exec(['memory', 'read', `notes/n${i}.md`]))
      );
      reads.forEach((r, i) => {
        expect(r.code, r.stderr).toBe(0);
        expect(r.stdout).toContain(`body-${i}`);
      });

      expect(commitCount(vaultDir)).toBe(10);
      expect(workingTreeClean(vaultDir)).toBe(true);
      expect(hasIndexLock(vaultDir)).toBe(false);
      expect(fsckClean(vaultDir)).toBe(true);
    } finally {
      await m.exec(['daemon', 'stop']).catch(() => undefined);
      if (pid !== null && alive(pid)) process.kill(pid, 'SIGKILL');
      m.cleanup();
    }
  });

  test('5 concurrent writes to one path keep the repo consistent', async () => {
    const port = await freePort();
    const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
    const vaultDir = join(m.configDir, 'main');
    const bodies = Array.from({ length: 5 }, (_, i) => `body-${i}`);
    let pid: number | null = null;
    try {
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);
      expect((await m.exec(['daemon', 'start'])).code).toBe(0);
      pid = daemonPid(m);

      const writes = await Promise.all(
        bodies.map((b) => m.exec(['memory', 'write', 'notes/same.md', '--body', b]))
      );
      for (const w of writes) expect(w.code, w.stderr).toBe(0);

      // Last-writer-wins: the surviving content is exactly one of the five, never a torn blend.
      const read = await m.exec(['memory', 'read', 'notes/same.md']);
      expect(read.code, read.stderr).toBe(0);
      expect(bodies).toContain(read.stdout.trim());

      // Five distinct bodies applied serially -> five commits, no torn index.
      expect(commitCount(vaultDir)).toBe(5);
      expect(workingTreeClean(vaultDir)).toBe(true);
      expect(hasIndexLock(vaultDir)).toBe(false);
      expect(fsckClean(vaultDir)).toBe(true);
    } finally {
      await m.exec(['daemon', 'stop']).catch(() => undefined);
      if (pid !== null && alive(pid)) process.kill(pid, 'SIGKILL');
      m.cleanup();
    }
  });

  test('path traversal and absolute paths are refused, nothing escapes the vault', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);

      const escape = join(m.configDir, 'escape.md'); // one level above the vault root
      const abs = join(m.configDir, 'abs-escape.md');
      const attempts: Array<[string, string]> = [
        ['../escape.md', escape],
        ['@main/../escape.md', escape],
        [abs, abs], // an absolute path
      ];
      for (const [ref, leaked] of attempts) {
        const res = await m.exec(['memory', 'write', ref, '--body', 'x']);
        expect(res.code, `write ${ref} should be refused`).not.toBe(0);
        expect(res.stderr + res.stdout).toContain('invalid path');
        expect(existsSync(leaked), `${leaked} must not be created`).toBe(false);
      }
    } finally {
      m.cleanup();
    }
  });

  test('a no-op write adds no commit and reports the current HEAD', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);

      const first = await m.exec([
        'memory',
        'write',
        'notes/x.md',
        '--body',
        'identical',
        '--json',
      ]);
      expect(first.code, first.stderr).toBe(0);
      const rev1 = (JSON.parse(first.stdout) as { rev: string }).rev;
      const commitsBefore = commitCount(vaultDir);

      const second = await m.exec([
        'memory',
        'write',
        'notes/x.md',
        '--body',
        'identical',
        '--json',
      ]);
      expect(second.code, second.stderr).toBe(0);
      const rev2 = (JSON.parse(second.stdout) as { rev: string }).rev;

      expect(rev2).toBe(rev1); // no new commit was minted
      expect(commitCount(vaultDir)).toBe(commitsBefore);
      expect(rev2).toBe(git(vaultDir, ['rev-parse', 'HEAD']).trim());
    } finally {
      m.cleanup();
    }
  });

  test('a body piped over stdin round-trips', async () => {
    const m = createCliMachine();
    try {
      const vaultDir = join(m.configDir, 'main');
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);

      const body = 'piped-body-marsupial';
      const write = await execStdin(
        m.configDir,
        ['memory', 'write', 'notes/x.md', '--body', '-'],
        body
      );
      expect(write.code, write.stdout).toBe(0);

      const read = await m.exec(['memory', 'read', 'notes/x.md']);
      expect(read.stdout).toContain(body);
    } finally {
      m.cleanup();
    }
  });

  test('the offline update check degrades to a calm verdict, exit 0, no traceback', async () => {
    // Point the endpoint at a reserved, unresolvable host so the check must fail its lookup.
    const m = createCliMachine({ ...OFFLINE, AGENTAGE_SITE_FQDN: 'offline.invalid' });
    try {
      const res = await m.exec(['update', '--check'], 20_000);
      expect(res.code, res.stderr).toBe(0); // exit 0 means it neither hung (killed) nor threw
      expect(res.stdout.trim().length).toBeGreaterThan(0); // a verdict was printed
      expect(/\bat\s+\S+\s+\(/.test(res.stderr + res.stdout), 'no stack trace').toBe(false);
    } finally {
      m.cleanup();
    }
  });

  test('vault remove leaves the files and git history on disk', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      expect((await m.exec(['vault', 'add', 'main', '--local', vaultDir])).code).toBe(0);
      expect((await m.exec(['memory', 'write', 'notes/keep.md', '--body', 'durable'])).code).toBe(
        0
      );
      const commits = commitCount(vaultDir);

      const rm = await m.exec(['vault', 'remove', 'main']);
      expect(rm.code, rm.stderr).toBe(0);

      // The registry entry is gone, but the on-disk repo is untouched.
      expect(Object.keys(JSON.parse((await m.exec(['vault', 'list', '--json'])).stdout))).toEqual(
        []
      );
      expect(existsSync(join(vaultDir, 'notes', 'keep.md'))).toBe(true);
      expect(existsSync(join(vaultDir, '.git'))).toBe(true);
      expect(commitCount(vaultDir)).toBe(commits);
    } finally {
      m.cleanup();
    }
  });

  // Issue #231: two batches of real `vault add` processes racing one shared vaults.json - the exact
  // lockless read-modify-write that silently dropped a reported add (2/40 in the prior probe). With
  // the advisory config lock every entry must survive: valid JSON, all names present, no stale lock.
  test('30 concurrent vault-add processes on one config all land, none lost', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const names = [
        ...Array.from({ length: 20 }, (_, i) => `cli${i}`),
        ...Array.from({ length: 10 }, (_, i) => `other${i}`), // the competing writer batch
      ];
      const results = await Promise.all(
        names.map((n) => m.exec(['vault', 'add', n, '--local', join(m.configDir, n)]))
      );
      results.forEach((r, i) => expect(r.code, `add ${names[i]} failed:\n${r.stderr}`).toBe(0));

      const raw = readFileSync(join(m.configDir, 'vaults.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { vaults: Record<string, unknown> }; // valid JSON, not torn
      expect(Object.keys(parsed.vaults).sort()).toEqual([...names].sort());
      expect(readdirSync(m.configDir).filter((f) => f.endsWith('.lock'))).toEqual([]);
    } finally {
      m.cleanup();
    }
  });
});
