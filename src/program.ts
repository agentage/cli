import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import { registerSetup, type SetupOptions } from './commands/auth/setup.js';
import { registerDaemon, type DaemonOptions } from './commands/daemon/daemon.js';
import {
  type ExtensionBuildOptions,
  type ExtensionCheckOptions,
} from './commands/extension/build.js';
import { type ExtensionCreateOptions } from './commands/extension/create.js';
import { registerDelegates } from './commands/extension/delegate.js';
import { type ExtensionDoctorOptions } from './commands/extension/doctor.js';
import { type ConfigureOptions } from './commands/extension/configure.js';
import { type InstallOptions, type RemoveOptions } from './commands/extension/lifecycle.js';
import {
  type ExtensionUpdateOptions,
  type ListOptions,
} from './commands/extension/lifecycle-list.js';
import { registerExtension } from './commands/extension/list.js';
import { KIT_EXIT } from './commands/extension/kit-commands.js';
import { type LoadKitTool } from './commands/extension/kit-tool.js';
import { type ExtensionReleaseOptions } from './commands/extension/release.js';
import {
  type ExtensionDownOptions,
  type ExtensionTokenOptions,
  type ExtensionUpOptions,
} from './commands/extension/up.js';
import { registerStatus, type StatusOptions } from './commands/status/status.js';
import { registerUpdate, type UpdateOptions } from './commands/update/update.js';
import { messageOf, writeError } from './lib/json-output.js';
import {
  ACTION_FAILED,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  pinned,
  withAction,
} from './lib/with-action.js';
import { defaultDeps } from './program-deps.js';
import { VERSION } from './utils/version.js';

type Run<T> = (opts: T) => Promise<unknown>;

export interface ProgramDeps {
  setup: (opts: SetupOptions) => Promise<unknown>;
  status: (opts: StatusOptions) => Promise<unknown>;
  update: (opts: UpdateOptions) => Promise<unknown>;
  extensionInstall: Run<InstallOptions>;
  extensionRemove: Run<RemoveOptions>;
  extensionList: Run<ListOptions>;
  extensionUpdate: Run<ExtensionUpdateOptions>;
  extensionEnabled: Run<{ id: string; enabled: boolean; json?: boolean }>;
  extensionConfigure: Run<ConfigureOptions>;
  extensionDoctor: (opts: ExtensionDoctorOptions) => Promise<unknown>;
  extensionCreate: (opts: ExtensionCreateOptions) => Promise<unknown>;
  extensionCheck: (opts: ExtensionCheckOptions) => Promise<unknown>;
  extensionBuild: (opts: ExtensionBuildOptions) => Promise<unknown>;
  extensionRelease: (opts: ExtensionReleaseOptions) => Promise<unknown>;
  extensionUp: (opts: ExtensionUpOptions) => Promise<unknown>;
  extensionDown: (opts: ExtensionDownOptions) => Promise<unknown>;
  extensionToken: (opts: ExtensionTokenOptions) => Promise<unknown>;
  daemon: Record<'status' | 'stop' | 'restart' | 'run', Run<DaemonOptions>>;
  // The kit's tool library, which runs the commands of kit-built extensions.
  kitTool: LoadKitTool;
  updateHint: () => string | null;
  refreshUpdateCache: () => Promise<void>;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

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
    update: withAction(deps, deps.extensionUpdate),
    enabled: withAction(deps, deps.extensionEnabled),
    configure: withAction(deps, deps.extensionConfigure),
    doctor: withAction(deps, deps.extensionDoctor, '', pinned),
    create: withAction(deps, deps.extensionCreate),
    check: withAction(deps, deps.extensionCheck, '', pinned),
    build: withAction(deps, deps.extensionBuild),
    release: withAction(deps, deps.extensionRelease),
    up: withAction(deps, deps.extensionUp),
    down: withAction(deps, deps.extensionDown),
    token: withAction(deps, deps.extensionToken),
  });
  try {
    registerDelegates(program, argv, (fn) => withAction(deps, fn), deps.kitTool);
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
  registerSetup(
    program,
    withAction(deps, deps.setup, 'Setup failed: ', (o: SetupOptions) => !!(o.dryRun || o.check))
  );
  registerStatus(program, withAction(deps, deps.status, '', pinned));
  registerUpdate(program, withAction(deps, deps.update));
  const daemon = (fn: Run<DaemonOptions>) => withAction(deps, fn);
  registerDaemon(program, {
    status: daemon(deps.daemon.status),
    stop: daemon(deps.daemon.stop),
    restart: daemon(deps.daemon.restart),
    run: daemon(deps.daemon.run),
  });
  addExtensions(program, deps, argv);
  return program;
};

// --help and --version stay 0; a kit command keeps its code; other commander errors are usage.
const exitCodeOf = (err: unknown, deps: ProgramDeps, argv: string[]): number => {
  if (!(err instanceof CommanderError)) {
    deps.writeErr(`${chalk.red(messageOf(err))}\n`);
    return EXIT_FAILED;
  }
  if (err.code === ACTION_FAILED) return EXIT_FAILED;
  if (err.code === KIT_EXIT) return err.exitCode;
  if (err.exitCode === 0) return EXIT_OK;
  if (!argv.includes('--json')) return EXIT_USAGE;
  writeError(deps, err, 'usage'); // a usage error under --json is still one envelope
  return EXIT_FAILED;
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
    return exitCodeOf(err, deps, argv);
  }
};
