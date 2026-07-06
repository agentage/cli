import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { type Command } from 'commander';
import { isDaemonRunning, resolvePort, stopDaemon } from '../daemon/lifecycle.js';
import { spawnDaemon } from '../lib/daemon-client.js';
import { checkForUpdate, INSTALL_HINT, type UpdateInfo } from '../lib/update-check.js';
import { acquireUpdateLock, releaseUpdateLock } from '../lib/update-lock.js';
import { VERSION } from '../utils/version.js';

const pexec = promisify(execFile);

export interface RestartDeps {
  running?: () => boolean;
  stop?: () => boolean;
  start?: (port: number) => Promise<boolean>;
}

// Restart a running daemon so it picks up the freshly installed binary; a stopped daemon is left
// stopped. Returns whether a restart happened.
export const restartDaemonIfRunning = async (deps: RestartDeps = {}): Promise<boolean> => {
  const running = deps.running ?? isDaemonRunning;
  if (!running()) return false;
  (deps.stop ?? stopDaemon)();
  await (deps.start ?? spawnDaemon)(resolvePort());
  return true;
};

export interface UpdateDeps {
  check: (installed: string) => Promise<UpdateInfo>;
  install: () => Promise<void>;
  restartDaemon: () => Promise<boolean>;
  acquireLock: () => boolean;
  releaseLock: () => void;
  log: (msg: string) => void;
}

const defaultDeps: UpdateDeps = {
  check: checkForUpdate,
  install: async () => {
    await pexec('npm', ['install', '-g', '@agentage/cli@latest']);
  },
  restartDaemon: () => restartDaemonIfRunning(),
  acquireLock: () => acquireUpdateLock(),
  releaseLock: releaseUpdateLock,
  log: (msg) => console.log(msg),
};

export interface UpdateOptions {
  check?: boolean;
}

const describe = (info: UpdateInfo): string => {
  const s = info.status;
  switch (s.kind) {
    case 'current':
      return chalk.green(`Already on the latest version (${VERSION}).`);
    case 'update-available':
      return chalk.yellow(`Update available: ${VERSION} -> ${s.latest}.`);
    case 'unsupported':
      return chalk.red(
        `Unsupported version ${VERSION} - update required (latest ${s.latest ?? '?'}).`
      );
    case 'unknown':
      return chalk.yellow(`Couldn't reach the registry - try again later. ${INSTALL_HINT}`);
  }
};

// Install, then restart a running daemon so its in-process engine runs the new version.
const install = async (deps: UpdateDeps): Promise<void> => {
  deps.log('Installing the latest @agentage/cli...');
  await deps.install();
  deps.log(chalk.green('Updated. Run `agentage status` to confirm.'));
  if (await deps.restartDaemon()) deps.log(chalk.green('Restarted the daemon on the new version.'));
};

// --check reports the verdict and never installs. Otherwise, install only when the registry says
// we're behind (available/unsupported), guarded by a single-writer lock; current/unreachable just
// report.
export const runUpdate = async (
  opts: UpdateOptions,
  deps: UpdateDeps = defaultDeps
): Promise<void> => {
  const info = await deps.check(VERSION);
  deps.log(describe(info));
  const behind = info.status.kind === 'update-available' || info.status.kind === 'unsupported';
  if (opts.check || !behind) return;
  if (!deps.acquireLock()) {
    deps.log(chalk.yellow('Another update is already in progress; skipping.'));
    return;
  }
  try {
    await install(deps);
  } finally {
    deps.releaseLock();
  }
};

export const registerUpdate = (program: Command): void => {
  program
    .command('update')
    .description('Update @agentage/cli to the latest published version')
    .option('--check', 'report whether an update is available, without installing')
    .action(async (opts: UpdateOptions) => {
      try {
        await runUpdate(opts);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
};
