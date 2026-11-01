import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import { registerSetup, type SetupDeps, type SetupOptions } from './commands/auth/setup.js';
import { runExtensionCheck, type ExtensionCheckOptions } from './commands/extension/check.js';
import { registerDelegates } from './commands/extension/delegate.js';
import { runExtensionInstall, type ExtensionInstallOptions } from './commands/extension/install.js';
import {
  registerExtension,
  runExtensionList,
  type ExtensionListOptions,
} from './commands/extension/list.js';
import {
  runExtensionRemove,
  terminalIo,
  type ExtensionRemoveOptions,
} from './commands/extension/remove.js';
import { signedInAccount } from './commands/extension/account.js';
import { runExtensionSetup } from './commands/extension/setup.js';
import {
  registerStatus,
  runStatus,
  statusDeps,
  type StatusOptions,
} from './commands/status/status.js';
import { registerUpdate, runUpdate, type UpdateOptions } from './commands/update/update.js';
import { npmMajor, prepareManifest, prepareNpm } from './core/installer/npm.js';
import { ensureSignedIn, signOut } from './lib/auth/sign-in.js';
import { refreshUpdateCache, updateHint } from './lib/update/update-cache.js';
import { VERSION } from './utils/version.js';

export interface ProgramDeps {
  setup: (opts: SetupOptions) => Promise<void>;
  status: (opts: StatusOptions) => Promise<void>;
  update: (opts: UpdateOptions) => Promise<void>;
  extensionInstall: (opts: ExtensionInstallOptions) => Promise<void>;
  extensionRemove: (opts: ExtensionRemoveOptions) => Promise<void>;
  extensionList: (opts: ExtensionListOptions) => Promise<void>;
  extensionCheck: (opts: ExtensionCheckOptions) => Promise<void>;
  updateHint: () => string | null;
  refreshUpdateCache: () => Promise<void>;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

const setupDeps: SetupDeps = {
  ensureSignedIn: (signInOpts) => ensureSignedIn(signInOpts),
  signOut: () => signOut(),
  printStatus: (opts) => runStatus(opts, statusDeps(false)),
};

// What a profile edit reaches: npm, and the account it syncs with when signed in.
const editDeps = { npm: () => prepareNpm(), npmMajor: () => npmMajor(), account: signedInAccount };

const defaultDeps: ProgramDeps = {
  setup: (opts) => runExtensionSetup(opts, { ...setupDeps, ...editDeps }),
  status: (opts) => runStatus(opts),
  update: (opts) => runUpdate(opts),
  extensionInstall: (opts) =>
    runExtensionInstall(opts, { ...editDeps, manifest: () => prepareManifest() }),
  extensionRemove: (opts) => runExtensionRemove(opts, { ...editDeps, io: terminalIo() }),
  extensionList: (opts) => runExtensionList(opts),
  extensionCheck: (opts) => runExtensionCheck(opts),
  updateHint,
  refreshUpdateCache: () => refreshUpdateCache(),
  writeOut: (text) => void process.stdout.write(text),
  writeErr: (text) => void process.stderr.write(text),
};

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
const ACTION_FAILED = 'agentage.actionFailed';

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// One failure path: a red stderr line, exit 1; an extension's --help or usage error keeps its code.
const withAction =
  <T>(deps: ProgramDeps, fn: (opts: T) => Promise<void>, prefix = '') =>
  async (opts: T): Promise<void> => {
    try {
      await fn(opts);
    } catch (err) {
      if (err instanceof CommanderError) throw err;
      deps.writeErr(`${chalk.red(`${prefix}${messageOf(err)}`)}\n`);
      throw new CommanderError(EXIT_FAILED, ACTION_FAILED, messageOf(err));
    }
  };

// status and update report update state themselves; the hint never touches --json stdout.
const hintAfter =
  (deps: ProgramDeps) =>
  (_program: Command, action: Command): void => {
    if (action.name() === 'status' || action.name() === 'update') return;
    const hint = action.opts()['json'] ? null : deps.updateHint();
    if (hint) deps.writeErr(`${chalk.dim(hint)}\n`);
    void deps.refreshUpdateCache();
  };

// Extension manifests are read as data; whatever goes wrong there, today's commands still run.
const addExtensions = (program: Command, deps: ProgramDeps, argv: string[]): void => {
  registerExtension(program, {
    install: withAction(deps, deps.extensionInstall),
    remove: withAction(deps, deps.extensionRemove),
    list: withAction(deps, deps.extensionList),
    check: withAction(deps, deps.extensionCheck),
  });
  try {
    registerDelegates(program, argv, (fn) => withAction(deps, fn));
  } catch (err) {
    deps.writeErr(`${chalk.yellow(`warning: extension commands skipped: ${messageOf(err)}`)}\n`);
  }
};

// `argv` reaches an extension's own Command unchanged, so it parses exactly what was typed.
export const createProgram = (
  deps: ProgramDeps = defaultDeps,
  argv: string[] = process.argv
): Command => {
  const program = new Command()
    .name('agentage')
    .description('Connect this machine to agentage from the terminal')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: deps.writeOut, writeErr: deps.writeErr })
    .addHelpText('after', '\nNew here? Run: agentage setup to connect this machine.')
    .hook('postAction', hintAfter(deps));
  registerSetup(program, withAction(deps, deps.setup, 'Setup failed: '));
  registerStatus(program, withAction(deps, deps.status));
  registerUpdate(program, withAction(deps, deps.update));
  addExtensions(program, deps, argv);
  return program;
};

// Commander's own exit 0 (--help, --version) stays 0; any other commander error is usage.
const exitCodeOf = (err: unknown, deps: ProgramDeps): number => {
  if (!(err instanceof CommanderError)) {
    deps.writeErr(`${chalk.red(messageOf(err))}\n`);
    return EXIT_FAILED;
  }
  if (err.code === ACTION_FAILED) return EXIT_FAILED;
  return err.exitCode === 0 ? EXIT_OK : EXIT_USAGE;
};

// Returns the exit code instead of exiting, so piped stdout is never cut short.
export const run = async (
  argv: string[] = process.argv,
  deps: ProgramDeps = defaultDeps
): Promise<number> => {
  if (process.env['NO_COLOR']) chalk.level = 0; // chalk ignores NO_COLOR on its own
  try {
    await createProgram(deps, argv).parseAsync(argv);
    return EXIT_OK;
  } catch (err) {
    return exitCodeOf(err, deps);
  }
};
