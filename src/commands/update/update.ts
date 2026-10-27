import { join } from 'node:path';
import chalk from 'chalk';
import { type Command } from 'commander';
import { getConfigDir } from '../../lib/fs/config.js';
import { acquireFileLock, releaseFileLock, type LockOptions } from '../../lib/fs/file-lock.js';
import { requireNpm10, runNpm } from '../../lib/npm/npm-cli.js';
import { checkForUpdate, INSTALL_HINT, type UpdateInfo } from '../../lib/update/update-check.js';
import { VERSION } from '../../utils/version.js';

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const NPM_TAIL_LINES = 10;
// An install takes minutes, so the crashed-holder ages scale up from the config-write defaults.
const UPDATE_LOCK: LockOptions = { ttlMs: 10 * 60_000, hardStaleMs: 30 * 60_000 };

const updateLockTarget = (): string => join(getConfigDir(), 'update');

const tail = (text: string): string => text.trimEnd().split('\n').slice(-NPM_TAIL_LINES).join('\n');

export const installLatest = async (
  run: typeof runNpm = runNpm,
  check: typeof requireNpm10 = requireNpm10
): Promise<void> => {
  await check(run);
  const res = await run(['install', '-g', '@agentage/cli@latest'], {
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  if (res.code !== 0)
    throw new Error(`npm install failed (exit ${res.code}):\n${tail(res.stderr || res.stdout)}`);
};

export interface UpdateDeps {
  check: (installed: string) => Promise<UpdateInfo>;
  install: () => Promise<void>;
  acquireLock: () => boolean;
  releaseLock: () => void;
  log: (msg: string) => void;
}

const defaultDeps: UpdateDeps = {
  check: checkForUpdate,
  install: () => installLatest(),
  acquireLock: () => acquireFileLock(updateLockTarget(), Date.now(), UPDATE_LOCK),
  releaseLock: () => releaseFileLock(updateLockTarget()),
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

const install = async (deps: UpdateDeps): Promise<void> => {
  deps.log('Installing the latest @agentage/cli...');
  await deps.install();
  deps.log(chalk.green('Updated. Run `agentage status` to confirm.'));
};

// --check never installs; otherwise install only when behind, under a single-writer lock.
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

export const registerUpdate = (
  program: Command,
  action: (opts: UpdateOptions) => Promise<void>
): void => {
  program
    .command('update')
    .description('Update @agentage/cli to the latest published version')
    .option('--check', 'report whether an update is available, without installing')
    .action(action);
};
