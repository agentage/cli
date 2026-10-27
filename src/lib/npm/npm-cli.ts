import { execFile, type ExecFileException } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export interface NpmResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunNpmOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface ResolveNpmOptions {
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}

const NPM_CLI = join('npm', 'bin', 'npm-cli.js');
const NPM_MIN_MAJOR = 10;
const VERSION_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

// POSIX prefixes keep npm in <prefix>/lib/node_modules; the Windows installer puts it beside node.exe.
const bundledCandidates = (execPath: string): string[] => [
  join(dirname(execPath), '..', 'lib', 'node_modules', NPM_CLI),
  join(dirname(execPath), 'node_modules', NPM_CLI),
];

// Homebrew-style installs keep npm apart from node; their `npm` on PATH links to npm-cli.js.
const fromPath = (env: NodeJS.ProcessEnv): string | undefined => {
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      const real = realpathSync(join(dir, 'npm'));
      if (real.endsWith('npm-cli.js')) return real;
    } catch {
      // no npm in this PATH entry
    }
  }
  return undefined;
};

// npm runs as `node npm-cli.js`: no shell and no platform shim (npm.cmd) in between.
export const resolveNpmCli = (opts: ResolveNpmOptions = {}): string => {
  const execPath = opts.execPath ?? process.execPath;
  const env = opts.env ?? process.env;
  const bundled = bundledCandidates(execPath).find((path) => existsSync(path));
  if (bundled) return bundled;
  const fromEnv = env['npm_execpath'];
  if (fromEnv?.endsWith('npm-cli.js')) return fromEnv;
  const onPath = fromPath(env);
  if (onPath) return onPath;
  throw new Error(`npm-cli.js not found next to ${execPath}`);
};

const isScrubbed = (key: string): boolean =>
  /^npm_config_/i.test(key) || key.toUpperCase() === 'NODE_OPTIONS';

// Inherited npm_config_* (an `npx` or `npm run` parent) would redirect a global install.
const childEnv = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !isScrubbed(key))),
  ...env,
});

const failureNote = (err: ExecFileException | null, timeoutMs: number): string => {
  if (!err || typeof err.code === 'number') return '';
  if (err.killed) return `\nnpm timed out after ${timeoutMs}ms`;
  return `\nnpm could not run (${String(err.code ?? err.signal ?? 'unknown')})`;
};

export const runNpm = (args: string[], opts: RunNpmOptions): Promise<NpmResult> =>
  new Promise((resolve) => {
    const argv = [resolveNpmCli(), ...args, '--no-audit', '--no-fund'];
    const options = {
      cwd: opts.cwd,
      env: childEnv(opts.env),
      timeout: opts.timeoutMs,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    };
    execFile(process.execPath, argv, options, (err, stdout, stderr) => {
      const code = !err ? 0 : typeof err.code === 'number' ? err.code : 1;
      resolve({ code, stdout, stderr: stderr + failureNote(err, opts.timeoutMs) });
    });
  });

export const requireNpm10 = async (run: typeof runNpm = runNpm): Promise<string> => {
  const res = await run(['--version'], { timeoutMs: VERSION_TIMEOUT_MS });
  const version = res.stdout.trim();
  if (res.code !== 0 || !(Number.parseInt(version, 10) >= NPM_MIN_MAJOR))
    throw new Error(`npm ${NPM_MIN_MAJOR} or newer is required (found ${version || 'none'})`);
  return version;
};
