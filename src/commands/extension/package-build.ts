import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CheckReport } from '@agentage/extension/tool';
import { childEnv } from '../../lib/child-env.js';
import { isRecord } from '../../lib/fs/json-file.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { resolveNpmCli } from '../../lib/npm/npm-cli.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';

const STEP_MS = 600_000;
const GRACE_MS = 5_000;

export type Npm = (dir: string, args: string[]) => Promise<void>;

const failed = (what: string, why: string): CliError =>
  new CliError('build_failed', `${what} ${why}`);

export const how = (code: number | null, signal: NodeJS.Signals | null): string =>
  code === null ? `exited by signal ${signal ?? 'unknown'}` : `exited ${code}`;

// npm runs as `node npm-cli.js`: no npm.cmd shim, which Windows cannot spawn with no shell.
const spawnNpm = (dir: string, args: string[], npmCli: () => string): ChildProcess =>
  spawn(process.execPath, [npmCli(), ...args], {
    cwd: dir,
    env: childEnv(),
    stdio: ['ignore', 2, 2],
    windowsHide: true,
  });

const deadline = (child: ChildProcess, timeoutMs: number, graceMs: number) => {
  let late = false;
  let kill: NodeJS.Timeout | undefined;
  const timer = setTimeout(() => {
    late = true;
    child.kill('SIGTERM');
    kill = setTimeout(() => child.kill('SIGKILL'), graceMs);
  }, timeoutMs);
  return { late: () => late, stop: () => (clearTimeout(timer), clearTimeout(kill)) };
};

// npm's output goes to stderr (a --json stdout stays one object); past its time SIGTERM, then SIGKILL.
export const npmIn = (
  dir: string,
  args: string[],
  timeoutMs = STEP_MS,
  graceMs = GRACE_MS,
  npmCli = resolveNpmCli
): Promise<void> =>
  new Promise((done, fail) => {
    const what = `npm ${args.join(' ')} in ${dir}`;
    const notStarted = (err: unknown) => fail(failed(what, `did not start: ${messageOf(err)}`));
    let child: ChildProcess;
    try {
      child = spawnNpm(dir, args, () => npmCli());
    } catch (err) {
      return notStarted(err);
    }
    const clock = deadline(child, timeoutMs, graceMs);
    child.once('error', (err) => (clock.stop(), notStarted(err)));
    child.once('exit', (code, signal) => {
      clock.stop();
      if (code === 0) return done();
      const stopped = `did not finish in ${timeoutMs / 1000} s; stopped (${how(code, signal)})`;
      fail(failed(what, clock.late() ? stopped : how(code, signal)));
    });
  });

export const packageOf = (dir: string): Record<string, unknown> => {
  const file = join(dir, 'package.json');
  if (!existsSync(file))
    throw new CliError(
      'invalid_argument',
      `no package.json in ${dir}: run it in an extension package folder`
    );
  const pkg: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isRecord(pkg) ? pkg : {};
};

export const buildScriptOf = (dir: string): string | null => {
  const scripts = packageOf(dir)['scripts'];
  const script = isRecord(scripts) ? scripts['build'] : undefined;
  return typeof script === 'string' ? script : null;
};

export interface PackageBuild {
  dir: string;
  built: boolean;
  contracts: string[];
  report: CheckReport;
}

export interface PackageBuildDeps {
  npm: Npm;
  tool: LoadKitTool;
}

const defaultDeps: PackageBuildDeps = { npm: npmIn, tool: loadKitTool };

// The author's build script, the kit's contract files, then the kit's check; no Docker.
export const buildPackage = async (
  folder = '.',
  deps: PackageBuildDeps = defaultDeps
): Promise<PackageBuild> => {
  const dir = resolve(folder);
  const built = buildScriptOf(dir) !== null;
  if (built) await deps.npm(dir, ['run', 'build']);
  const kit = await deps.tool();
  const contracts = await kit.writeContracts(dir);
  for (const file of contracts) console.log(`wrote     ${file}`);
  return { dir, built, contracts, report: await kit.check(dir) };
};
