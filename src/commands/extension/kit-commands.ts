import { CommanderError, type Command } from 'commander';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { type Verbs } from '../../core/loader/verbs.js';
import { type LoadKitTool } from './kit-tool.js';
import { helpOrUnknown } from './list.js';

// A kit command's own exit code: the program returns it as the CLI's.
export const KIT_EXIT = 'agentage.kitExit';

type Run = (opts: unknown) => Promise<void>;

export interface KitRegistration {
  argv: string[];
  wrap: (fn: () => Promise<void>) => Run;
  tool: LoadKitTool;
}

// The kit parses args and owns --json and --help; the token never reaches extension code.
const runKit = async (tool: LoadKitTool, dir: string, command: string, argv: string[]) => {
  const { runCommand } = await tool();
  delete process.env['AGENTAGE_TOKEN'];
  const code = await runCommand({ dir, command, argv });
  if (code !== 0) throw new CommanderError(code, KIT_EXIT, `${command} exited ${code}`);
};

// A stub per command: help from the manifest, the rest of the line to the extension's own code.
export const stub = (parent: Command, name: string, summary: string, run: Run): Command =>
  parent
    .command(name)
    .description(summary)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .action(run);

// `agentage {id}` alone prints its commands from the manifest; an unknown one is usage.
const groupOf = (program: Command, id: string): Command =>
  program
    .command(id)
    .description(`the commands of the ${id} extension`)
    .helpGroup(`${id}:`)
    .helpCommand(false)
    .allowExcessArguments()
    .action(helpOrUnknown);

// `agentage {id} {command}` always; `agentage {command}` where the verb is its own.
export const registerKit = (
  program: Command,
  ext: DiscoveredExtension,
  verbs: Verbs,
  { argv, wrap, tool }: KitRegistration
): void => {
  const id = ext.id ?? '';
  const group = groupOf(program, id);
  const run = (name: string, words: number) =>
    wrap(() => runKit(tool, ext.dir, name, argv.slice(2 + words)));
  for (const { name, summary } of ext.kitCommands) {
    stub(group, name, summary, run(name, 2));
    if (verbs.top.get(name) === ext.pkg)
      stub(program, name, summary, run(name, 1)).helpGroup(`${id}:`);
  }
};
