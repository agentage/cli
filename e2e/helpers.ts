/**
 * E2E harness for the CLI - drives the built CLI (dist/cli.js) as a
 * subprocess. Run `npm run build` first.
 *
 * Tiers: @offline is the PR tier - hermetic, the CLI talks only to loopback
 * stubs (e2e/stub/ for the site, e2e/registry/ for npm). @smoke tests are
 * read-only against the default target, AGENTAGE_SITE_FQDN (default agentage.io).
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export const TARGET_FQDN = process.env['AGENTAGE_SITE_FQDN'] ?? 'agentage.io';

// Mirrors the CLI's origins: a `127.0.0.1:<port>` stub serves auth itself over plain http.
export const authUrlFor = (fqdn: string): string =>
  /^127\.0\.0\.1:\d+$/.test(fqdn) ? `http://${fqdn}` : `https://auth.${fqdn}`;

export const AUTH_URL = authUrlFor(TARGET_FQDN);
export const CLI_BIN = process.env['CLI_BIN'] ?? join(process.cwd(), 'dist', 'cli.js');

// GNU timeout's convention, so a hung child never reads as an ordinary exit 1.
export const EXIT_TIMED_OUT = 124;

export const assertCliBuilt = (): void => {
  expect(existsSync(CLI_BIN), `CLI not built at ${CLI_BIN} - run: npm run build`).toBe(true);
};

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

export interface SetupProcess {
  output: () => string;
  stderr: () => string;
  waitExit: (timeoutMs?: number) => Promise<number>;
  kill: () => void;
}

export interface CliMachine {
  configDir: string;
  exec: (args: string[], timeoutMs?: number) => Promise<ExecResult>;
  startSetup: (args?: string[]) => SetupProcess;
  cleanup: () => void;
}

const machineEnv = (configDir: string, home: string, extra: NodeJS.ProcessEnv) => ({
  ...process.env,
  AGENTAGE_CONFIG_DIR: configDir,
  AGENTAGE_SITE_FQDN: TARGET_FQDN,
  NO_COLOR: '1',
  // Loopback (the in-process stubs) must bypass any proxy, blackhole or real.
  NO_PROXY: '127.0.0.1,localhost',
  // A throwaway home: nothing may read or write the developer's real dotfiles.
  HOME: home,
  // npm run exports the developer's npmrc path; pin it inside the throwaway home.
  npm_config_userconfig: join(home, '.npmrc'),
  // A private cache so a test can neither read nor poison the developer's npm cache.
  npm_config_cache: join(home, '.npm'),
  ...extra,
});

const execCli = (env: NodeJS.ProcessEnv, args: string[], timeoutMs: number) =>
  new Promise<ExecResult>((resolve) => {
    execFile(process.execPath, [CLI_BIN, ...args], { env, timeout: timeoutMs }, (err, out, e) => {
      const timedOut = err?.killed === true;
      const exit = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
      resolve({ stdout: out, stderr: e, code: timedOut ? EXIT_TIMED_OUT : exit, timedOut });
    });
  });

// A child still running at the deadline is killed and reported as EXIT_TIMED_OUT.
const exitWithin =
  (exit: Promise<number>, kill: () => void) =>
  async (timeoutMs = 30_000): Promise<number> => {
    const deadline = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs).unref());
    const code = await Promise.race([exit, deadline]);
    if (code !== null) return code;
    kill();
    return EXIT_TIMED_OUT;
  };

const spawnSetup = (env: NodeJS.ProcessEnv, args: string[]): SetupProcess => {
  const child = spawn(process.execPath, [CLI_BIN, ...args], { env });
  let buffer = '';
  let errBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => (buffer += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    errBuffer += chunk.toString();
  });
  const exit = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  const kill = (): void => void child.kill('SIGTERM');
  return { output: () => buffer, stderr: () => errBuffer, waitExit: exitWithin(exit, kill), kill };
};

export const createCliMachine = (extraEnv: NodeJS.ProcessEnv = {}): CliMachine => {
  const configDir = mkdtempSync(join(tmpdir(), 'agentage-cli-e2e-'));
  const home = mkdtempSync(join(tmpdir(), 'agentage-cli-home-'));
  const env = machineEnv(configDir, home, extraEnv);
  return {
    configDir,
    exec: (args, timeoutMs = 30_000) => execCli(env, args, timeoutMs),
    startSetup: (args = ['setup', '--no-browser']) => spawnSetup(env, args),
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
};

// Poll the CLI's streamed output until the OAuth authorize URL is printed.
export const waitForAuthorizeUrl = async (
  setup: SetupProcess,
  timeoutMs = 30_000
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = setup.output().match(/https?:\/\/\S+\/authorize\?\S+/);
    if (match) return match[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(false, `authorize URL never appeared; CLI output:\n${setup.output()}`).toBe(true);
  return '';
};

export interface CliStatusReport {
  version: string;
  fqdn: string;
  env: string;
  target: { fqdn: string; reachable: boolean };
  auth: { signedIn: boolean; tokenExpiresAt?: string; note?: string; transient?: boolean };
  endpoint: { url: string; reachable: boolean };
}

export const statusJson = async (machine: CliMachine): Promise<CliStatusReport> => {
  const result = await machine.exec(['status', '--json']);
  expect(result.code, `status --json failed:\n${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as CliStatusReport;
};

// Chalk colours whenever it detects a colour-capable environment (CI included), so any
// assertion that straddles a style boundary must compare against the plain text.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
export const plain = (s: string): string => s.replace(ANSI, '');
