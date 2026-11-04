import { isRecord } from '../../lib/fs/json-file.js';

// One entry of agentage.commands, read as data; the kit checks args when the command runs.
export interface KitCommand {
  name: string;
  summary: string;
}

export const DEFAULT_CLI_ENTRY = './dist/cli/index.js';
const COMMAND = /^[a-z0-9][a-z0-9-]*$/;

// A manifest with agentage.parts is built on the extension kit and is never register-loaded.
export const isKitShaped = (agentage: Record<string, unknown>): boolean =>
  agentage['parts'] !== undefined;

// parts.cli is true or { entry }; without an entry it is the kit's build output.
export const cliEntryOf = (parts: unknown): string | null => {
  const cli = isRecord(parts) ? parts['cli'] : undefined;
  if (cli === true) return DEFAULT_CLI_ENTRY;
  if (!isRecord(cli)) return null;
  return typeof cli['entry'] === 'string' ? cli['entry'] : DEFAULT_CLI_ENTRY;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const kitCommandsOf = (value: unknown): KitCommand[] =>
  (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .map((command) => ({ name: text(command['name']), summary: text(command['summary']) }));

const commandProblem = (value: unknown, seen: Set<string>): string | null => {
  const name = isRecord(value) ? value['name'] : undefined;
  if (typeof name !== 'string' || !COMMAND.test(name))
    return `agentage.commands: ${JSON.stringify(name ?? null)} must match [a-z0-9][a-z0-9-]*`;
  if (seen.has(name)) return `agentage.commands: "${name}" is declared twice`;
  seen.add(name);
  return isRecord(value) && typeof value['summary'] === 'string'
    ? null
    : `agentage.commands: "${name}" has no summary`;
};

const commandsProblem = (commands: unknown[]): string | null => {
  const seen = new Set<string>();
  for (const command of commands) {
    const problem = commandProblem(command, seen);
    if (problem) return problem;
  }
  return null;
};

// What reading the kit-shaped block as data can tell; the kit's own schema checks the rest.
export const kitShapeProblem = (agentage: Record<string, unknown>): string | null => {
  const { parts, commands = [] } = agentage;
  if (!isRecord(parts)) return 'agentage.parts must be an object';
  if (!Array.isArray(commands)) return 'agentage.commands must be a list';
  const problem = commandsProblem(commands);
  if (problem) return problem;
  return commands.length > 0 && cliEntryOf(parts) === null
    ? 'agentage.commands needs parts.cli'
    : null;
};
