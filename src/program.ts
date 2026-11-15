import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import { registerSetup, type SetupDeps, type SetupOptions } from './commands/auth/setup.js';
import {
  runExtensionBuild,
  runExtensionCheck,
  type ExtensionBuildOptions,
  type ExtensionCheckOptions,
} from './commands/extension/build.js';
import { runExtensionCreate, type ExtensionCreateOptions } from './commands/extension/create.js';
import { registerDelegates } from './commands/extension/delegate.js';
import { runExtensionDoctor, type ExtensionDoctorOptions } from './commands/extension/doctor.js';
import { openMarket } from './lib/net/market.js';
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
import { KIT_EXIT } from './commands/extension/kit-commands.js';
import { loadKitTool, type LoadKitTool } from './commands/extension/kit-tool.js';
import { runExtensionRelease, type ExtensionReleaseOptions } from './commands/extension/release.js';
import { runExtensionSetup } from './commands/extension/setup.js';
import {
  runExtensionDown,
  runExtensionToken,
  runExtensionUp,
  type ExtensionDownOptions,
  type ExtensionTokenOptions,
  type ExtensionUpOptions,
} from './commands/extension/up.js';
import {
  registerStatus,
  runStatus,
  statusDeps,
  type StatusOptions,
} from './commands/status/status.js';
import { registerUpdate, runUpdate, type UpdateOptions } from './commands/update/update.js';
import { npmMajor, prepareManifest, prepareNpm } from './core/installer/npm.js';
import { ensureSignedIn, signOut } from './lib/auth/sign-in.js';
import { messageOf, writeError } from './lib/json-output.js';
import {
  ACTION_FAILED,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  pinned,
  withAction,
} from './lib/with-action.js';
import { refreshUpdateCache, updateHint } from './lib/update/update-cache.js';
import { VERSION } from './utils/version.js';

export interface ProgramDeps {
  setup: (opts: SetupOptions) => Promise<unknown>;
  status: (opts: StatusOptions) => Promise<unknown>;
  update: (opts: UpdateOptions) => Promise<unknown>;
  extensionInstall: (opts: ExtensionInstallOptions) => Promise<unknown>;
  extensionRemove: (opts: ExtensionRemoveOptions) => Promise<unknown>;
  extensionList: (opts: ExtensionListOptions) => Promise<unknown>;
  extensionDoctor: (opts: ExtensionDoctorOptions) => Promise<unknown>;
  extensionCreate: (opts: ExtensionCreateOptions) => Promise<unknown>;
  extensionCheck: (opts: ExtensionCheckOptions) => Promise<unknown>;
  extensionBuild: (opts: ExtensionBuildOptions) => Promise<unknown>;
  extensionRelease: (opts: ExtensionReleaseOptions) => Promise<unknown>;
  extensionUp: (opts: ExtensionUpOptions) => Promise<unknown>;
  extensionDown: (opts: ExtensionDownOptions) => Promise<unknown>;
  extensionToken: (opts: ExtensionTokenOptions) => Promise<unknown>;
  // The kit's tool library, which runs the commands of kit-built extensions.
  kitTool: LoadKitTool;
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
    runExtensionInstall(opts, {
      ...editDeps,
      manifest: () => prepareManifest(),
      market: openMarket(),
    }),
  extensionRemove: (opts) => runExtensionRemove(opts, { ...editDeps, io: terminalIo() }),
  extensionList: (opts) => runExtensionList(opts, openMarket()),
  extensionDoctor: (opts) => runExtensionDoctor(opts),
  extensionCreate: (opts) => runExtensionCreate(opts),
  extensionCheck: (opts) => runExtensionCheck(opts),
  extensionBuild: (opts) => runExtensionBuild(opts),
  extensionRelease: (opts) => runExtensionRelease(opts),
  extensionUp: (opts) => runExtensionUp(opts),
  extensionDown: (opts) => runExtensionDown(opts),
  extensionToken: (opts) => runExtensionToken(opts),
  kitTool: loadKitTool,
  updateHint,
  refreshUpdateCache: () => refreshUpdateCache(),
  writeOut: (text) => void process.stdout.write(text),
  writeErr: (text) => void process.stderr.write(text),
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
    list: withAction(deps, deps.extensionList, '', pinned),
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
