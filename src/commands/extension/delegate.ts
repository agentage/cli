import { type Command } from 'commander';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { loadExtensions } from '../../core/loader/load.js';
import { loadOrder } from '../../core/loader/order.js';
import { loadSet, scan } from '../../core/loader/scan.js';
import { readMachine, type MachineFile } from '../../core/profile/machine.js';

// Without machine.json there are no dev paths and no `off` list; discovery never creates it.
const NO_MACHINE: MachineFile = { id: '', name: '', dev: {}, profileSource: 'default' };

// The CLI's own error handling around a stub's action.
type Wrap = (fn: () => Promise<void>) => (opts: unknown) => Promise<void>;

// Loads the command's extension and its peers only, then hands it the whole command line.
const runDelegated = async (
  ext: DiscoveredExtension,
  name: string,
  extensions: DiscoveredExtension[],
  program: Command,
  argv: string[]
): Promise<void> => {
  const session = await loadExtensions(loadOrder([ext], extensions), program);
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
  (program: Command, core: string[], extensions: DiscoveredExtension[]) =>
  (operands: string[]): void => {
    const lines = [`error: unknown command '${operands[0]}'`, `core: ${core.join(', ')}`];
    for (const ext of extensions.filter((e) => e.commands.length > 0))
      lines.push(`${ext.id}: ${ext.commands.join(', ')}`);
    program.error(lines.join('\n'), { code: 'commander.unknownCommand', exitCode: 2 });
  };

// Manifests only, never code: each stub hands the command line, --help included, to the extension.
export const registerDelegates = (program: Command, argv: string[], wrap: Wrap): void => {
  const core = program.commands.map((command) => command.name());
  const extensions = loadSet(scan(readMachine() ?? NO_MACHINE));
  for (const ext of extensions)
    for (const name of ext.commands)
      program
        .command(name)
        .description(`from the ${ext.id} extension`)
        .helpGroup(`${ext.id}:`)
        .helpOption(false)
        .allowUnknownOption()
        .allowExcessArguments()
        .action(wrap(() => runDelegated(ext, name, extensions, program, argv)));
  program.on('command:*', unknownCommand(program, core, extensions));
};
