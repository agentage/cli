import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import { registerSetup, runSetup, type SetupOptions } from './commands/auth/setup.js';
import { registerStatus, runStatus, type StatusOptions } from './commands/status/status.js';
import { registerUpdate, runUpdate, type UpdateOptions } from './commands/update/update.js';
import { ensureSignedIn, signOut } from './lib/auth/sign-in.js';
import { refreshUpdateCache, updateHint } from './lib/update/update-cache.js';
import { VERSION } from './utils/version.js';

export interface ProgramDeps {
  setup: (opts: SetupOptions) => Promise<void>;
  status: (opts: StatusOptions) => Promise<void>;
  update: (opts: UpdateOptions) => Promise<void>;
  updateHint: () => string | null;
  refreshUpdateCache: () => Promise<void>;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

const defaultDeps: ProgramDeps = {
  setup: (opts) =>
    runSetup(opts, {
      ensureSignedIn: (signInOpts) => ensureSignedIn(signInOpts),
      signOut: () => signOut(),
      printStatus: () => runStatus({}),
    }),
  status: (opts) => runStatus(opts),
  update: (opts) => runUpdate(opts),
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

// One failure path for every command: a red stderr line, then exit 1 through run().
const withAction =
  <T>(deps: ProgramDeps, fn: (opts: T) => Promise<void>, prefix = '') =>
  async (opts: T): Promise<void> => {
    try {
      await fn(opts);
    } catch (err) {
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

export const createProgram = (deps: ProgramDeps = defaultDeps): Command => {
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
    await createProgram(deps).parseAsync(argv);
    return EXIT_OK;
  } catch (err) {
    return exitCodeOf(err, deps);
  }
};
