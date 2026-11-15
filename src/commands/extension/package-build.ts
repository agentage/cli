import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CheckReport } from '@agentage/extension/tool';
import { childEnv } from '../../lib/child-env.js';
import { CliError } from '../../lib/json-output.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';

const STEP_MS = 600_000;
const GRACE_MS = 5_000;

export type Npm = (dir: string, args: string[]) => Promise<void>;

const failed = (what: string, why: string): CliError =>
  new CliError('build_failed', `${what} ${why}`);

const how = (code: number | null, signal: NodeJS.Signals | null): string =>
  code === null ? `exited by signal ${signal ?? 'unknown'}` : `exited ${code}`;

// npm's own output goes to stderr, so a --json stdout stays one object. Past its time it gets
// SIGTERM, then SIGKILL after `graceMs`.
export const npmIn = (
  dir: string,
  args: string[],
  timeoutMs = STEP_MS,
  graceMs = GRACE_MS
): Promise<void> =>
  new Promise((done, fail) => {
    const what = `npm ${args.join(' ')} in ${dir}`;
    const child = spawn('npm', args, { cwd: dir, env: childEnv(), stdio: ['ignore', 2, 2] });
    let late = false;
    let kill: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      late = true;
      child.kill('SIGTERM');
      kill = setTimeout(() => child.kill('SIGKILL'), graceMs);
    }, timeoutMs);
    const stop = () => (clearTimeout(timer), clearTimeout(kill));
    child.once('error', (err) => (stop(), fail(failed(what, `did not start: ${err.message}`))));
    child.once('exit', (code, signal) => {
      stop();
      if (code === 0) return done();
      const stopped = `did not finish in ${timeoutMs / 1000} s; stopped (${how(code, signal)})`;
      fail(failed(what, late ? stopped : how(code, signal)));
    });
  });

const hasBuildScript = (dir: string): boolean => {
  if (!existsSync(join(dir, 'package.json')))
    throw new CliError(
      'invalid_argument',
      `no package.json in ${dir}: run it in an extension package folder`
    );
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, unknown>;
  };
  return typeof pkg.scripts?.['build'] === 'string';
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
  const built = hasBuildScript(dir);
  if (built) await deps.npm(dir, ['run', 'build']);
  const kit = await deps.tool();
  const contracts = await kit.writeContracts(dir);
  for (const file of contracts) console.log(`wrote     ${file}`);
  return { dir, built, contracts, report: await kit.check(dir) };
};
