/**
 * E2E harness for the Memory CLI - drives the built CLI (dist/cli.js) as a
 * subprocess against a live deployed stack. Run `npm run build` first.
 *
 * Target: AGENTAGE_SITE_FQDN (default dev.agentage.io). The suite signs up
 * throwaway accounts - never point it at production.
 * Account: E2E_AUTH_EMAIL / E2E_AUTH_PASSWORD reuse a stable account when set;
 * otherwise each run signs up a fresh throwaway user.
 */
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, request as apiRequest, type APIRequestContext } from '@playwright/test';

export const TARGET_FQDN = process.env['AGENTAGE_SITE_FQDN'] ?? 'dev.agentage.io';
export const AUTH_URL = `https://auth.${TARGET_FQDN}`;
export const CLI_BIN = process.env['CLI_BIN'] ?? join(process.cwd(), 'dist', 'cli.js');

export const assertCliBuilt = (): void => {
  expect(existsSync(CLI_BIN), `CLI not built at ${CLI_BIN} - run: npm run build`).toBe(true);
};

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface SetupProcess {
  output: () => string;
  waitExit: () => Promise<number>;
  kill: () => void;
}

export interface CliMachine {
  configDir: string;
  exec: (args: string[], timeoutMs?: number) => Promise<ExecResult>;
  startSetup: (args?: string[]) => SetupProcess;
  cleanup: () => void;
}

export const createCliMachine = (): CliMachine => {
  const configDir = mkdtempSync(join(tmpdir(), 'agentage-cli-e2e-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTAGE_CONFIG_DIR: configDir,
    AGENTAGE_SITE_FQDN: TARGET_FQDN,
    NO_COLOR: '1',
  };

  const exec = (args: string[], timeoutMs = 30_000): Promise<ExecResult> =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [CLI_BIN, ...args],
        { env, timeout: timeoutMs },
        (error, stdout, stderr) => {
          const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
          resolve({ stdout, stderr, code });
        }
      );
    });

  const startSetup = (args = ['setup', '--no-browser']): SetupProcess => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { env });
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => (buffer += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (buffer += chunk.toString()));
    const exit = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 1)));
    return {
      output: () => buffer,
      waitExit: () => exit,
      kill: () => child.kill('SIGTERM'),
    };
  };

  return {
    configDir,
    exec,
    startSetup,
    cleanup: () => rmSync(configDir, { recursive: true, force: true }),
  };
};

// Poll the CLI's streamed output until the OAuth authorize URL is printed.
export const waitForAuthorizeUrl = async (
  setup: SetupProcess,
  timeoutMs = 30_000
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = setup.output().match(/https:\/\/\S+\/authorize\?\S+/);
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
  auth: { signedIn: boolean; tokenExpiresAt?: string; note?: string };
  endpoint: { url: string; reachable: boolean };
}

export const statusJson = async (machine: CliMachine): Promise<CliStatusReport> => {
  const result = await machine.exec(['status', '--json']);
  expect(result.code, `status --json failed:\n${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as CliStatusReport;
};

export interface TestAccount {
  email: string;
  password: string;
}

export const testAccount = (): TestAccount => {
  const email = process.env['E2E_AUTH_EMAIL'];
  const password = process.env['E2E_AUTH_PASSWORD'];
  if (email && password) return { email, password };
  return {
    email: `cli-e2e-${randomBytes(6).toString('hex')}@agentage.test`,
    password: `cli-e2e-${randomBytes(9).toString('base64url')}`,
  };
};

// Better Auth 403s cookie-bearing POSTs without a same-origin Origin header.
export const newBrowserContext = (): Promise<APIRequestContext> =>
  apiRequest.newContext({ baseURL: AUTH_URL, extraHTTPHeaders: { Origin: AUTH_URL } });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Sign the account in (sign up on first use); back off on 429 rate limits.
export const ensureSession = async (
  browser: APIRequestContext,
  account: TestAccount
): Promise<void> => {
  let last = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const signIn = await browser.post('/api/auth/sign-in/email', {
      data: { email: account.email, password: account.password },
    });
    if (signIn.ok()) return;
    last = signIn.status();
    if (last === 401 || last === 400) {
      const signUp = await browser.post('/api/auth/sign-up/email', {
        data: { email: account.email, password: account.password, name: 'CLI e2e' },
      });
      if (signUp.ok()) return;
    }
    await sleep(2_000 * (attempt + 1));
  }
  expect(false, `ensureSession failed after retries (last status ${last})`).toBe(true);
};
