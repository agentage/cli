import { type Command } from 'commander';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { loadExtensions } from '../../core/loader/load.js';
import { loadOrder } from '../../core/loader/order.js';
import { loadSet, scan } from '../../core/loader/scan.js';
import { claimVerbs, commandNames, readHeld, type Verbs } from '../../core/loader/verbs.js';
import { NO_MACHINE, readMachine } from '../../core/profile/machine.js';
import { registerKit } from './kit-commands.js';
import { kitCheck, loadKitTool, type LoadKitTool } from './kit-tool.js';

type Run = (opts: unknown) => Promise<void>;

// The CLI's own error handling around a stub's action.
type Wrap = (fn: () => Promise<void>) => Run;

// Loads the command's extension and its peers only, then hands it the whole command line.
const runDelegated = async (
  ext: DiscoveredExtension,
  name: string,
  extensions: DiscoveredExtension[],
  program: Command,
  argv: string[]
): Promise<void> => {
  const order = loadOrder([ext], extensions);
  const session = await loadExtensions(order, program, kitCheck());
  try {
    const loaded = session.loaded.get(ext.id ?? '');
    const run = session.outcomes.get(ext.pkg);
    if (!loaded) throw new Error(`extension ${ext.id} ${run?.state}: ${run?.error}`);
    if (!loaded.program.commands.some((command) => command.name() === name))
      throw new Error(`extension ${ext.id} did not add the command ${name}`);
    await loaded.program.parseAsync(argv);
  } finally {
    await session.dispose();
  }
};

// Usage, exit 2: the core commands, then one line per extension with what it contributes.
const unknownCommand =
  (program: Command, core: string[], extensions: DiscoveredExtension[], verbs: Verbs) =>
  (operands: string[]): void => {
    const lines = [`error: unknown command '${operands[0]}'`, `core: ${core.join(', ')}`];
    for (const ext of extensions.filter((e) => e.commands.length > 0))
      lines.push(`${ext.id}: ${commandNames(ext, verbs).join(', ')}`);
    program.error(lines.join('\n'), { code: 'commander.unknownCommand', exitCode: 2 });
  };

const registerApi = (program: Command, ext: DiscoveredExtension, run: (name: string) => Run) => {
  for (const name of ext.commands)
    program
      .command(name)
      .description(`from the ${ext.id} extension`)
      .helpGroup(`${ext.id}:`)
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .action(run(name));
};

// Manifests only, never code: each stub hands the command line, --help included, to the extension.
export const registerDelegates = (
  program: Command,
  argv: string[],
  wrap: Wrap,
  tool: LoadKitTool = loadKitTool
): void => {
  const core = program.commands.map((command) => command.name());
  const extensions = loadSet(scan(readMachine() ?? NO_MACHINE));
  const verbs = claimVerbs(extensions, readHeld());
  for (const ext of extensions) {
    if (ext.kind === 'kit') registerKit(program, ext, verbs, { argv, wrap, tool });
    else
      registerApi(program, ext, (name) =>
        wrap(() => runDelegated(ext, name, extensions, program, argv))
      );
  }
  program.on('command:*', unknownCommand(program, core, extensions, verbs));
};
