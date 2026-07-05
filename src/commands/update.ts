import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { type Command } from 'commander';
import { links, siteFqdn } from '../lib/origins.js';
import { checkForUpdate, INSTALL_HINT, type UpdateInfo } from '../lib/update-check.js';
import { VERSION } from '../utils/version.js';

const pexec = promisify(execFile);

export interface UpdateDeps {
  check: (apiUrl: string, installed: string) => Promise<UpdateInfo>;
  install: () => Promise<void>;
  log: (msg: string) => void;
}

const defaultDeps: UpdateDeps = {
  check: checkForUpdate,
  install: async () => {
    await pexec('npm', ['install', '-g', '@agentage/cli@latest']);
  },
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

// --check reports the verdict and never installs. Otherwise, install only when the
// registry says we're behind (available/unsupported); current/unreachable just report.
export const runUpdate = async (
  opts: UpdateOptions,
  deps: UpdateDeps = defaultDeps
): Promise<void> => {
  const info = await deps.check(links(siteFqdn()).api, VERSION);
  deps.log(describe(info));
  const behind = info.status.kind === 'update-available' || info.status.kind === 'unsupported';
  if (opts.check || !behind) return;
  deps.log('Installing the latest @agentage/cli...');
  await deps.install();
  deps.log(chalk.green('Updated. Run `agentage status` to confirm.'));
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
