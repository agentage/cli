import { type Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import chalk from 'chalk';

export type McpCommandStyle = 'npx' | 'binary';

interface McpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
}

interface McpConfigFile {
  kind: 'claude-code-project' | 'vscode-workspace';
  path: string;
  /** Top-level key under which MCP servers live in this client's config. */
  key: 'mcpServers' | 'servers';
}

export interface SetupMcpOptions {
  cwd?: string;
  style?: McpCommandStyle;
  force?: boolean;
  noProject?: boolean;
  noVscode?: boolean;
  json?: boolean;
}

interface TargetResult {
  kind: McpConfigFile['kind'];
  path: string;
  action: 'created' | 'added' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
}

const buildEntry = (style: McpCommandStyle): McpServerEntry =>
  style === 'binary'
    ? { type: 'stdio', command: 'agentage-mcp', args: [] }
    : { type: 'stdio', command: 'npx', args: ['-y', '@agentage/mcp'] };

const resolveTargets = (cwd: string, opts: SetupMcpOptions): McpConfigFile[] => {
  const targets: McpConfigFile[] = [];
  if (!opts.noProject) {
    targets.push({
      kind: 'claude-code-project',
      path: join(cwd, '.mcp.json'),
      key: 'mcpServers',
    });
  }
  if (!opts.noVscode) {
    targets.push({
      kind: 'vscode-workspace',
      path: join(cwd, '.vscode', 'mcp.json'),
      key: 'servers',
    });
  }
  return targets;
};

const readJson = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through — treat as empty to avoid wiping a malformed config blindly
  }
  throw new Error(`existing ${path} is not a JSON object — refusing to overwrite`);
};

const entriesEqual = (a: McpServerEntry, b: unknown): boolean => {
  if (!b || typeof b !== 'object') return false;
  const other = b as Partial<McpServerEntry>;
  if (other.type !== a.type || other.command !== a.command) return false;
  if (!Array.isArray(other.args) || other.args.length !== a.args.length) return false;
  return other.args.every((v, i) => v === a.args[i]);
};

export const writeMcpConfig = (
  target: McpConfigFile,
  entry: McpServerEntry,
  force: boolean
): TargetResult => {
  const existed = existsSync(target.path);
  const doc = readJson(target.path);
  const servers =
    doc[target.key] && typeof doc[target.key] === 'object' && !Array.isArray(doc[target.key])
      ? (doc[target.key] as Record<string, unknown>)
      : {};

  const prior = servers['agentage'];
  if (prior !== undefined) {
    if (entriesEqual(entry, prior)) {
      return { kind: target.kind, path: target.path, action: 'unchanged' };
    }
    if (!force) {
      return {
        kind: target.kind,
        path: target.path,
        action: 'skipped',
        reason: 'existing `agentage` entry differs — pass --force to overwrite',
      };
    }
  }

  servers['agentage'] = entry;
  doc[target.key] = servers;

  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, JSON.stringify(doc, null, 2) + '\n', 'utf-8');

  if (!existed) return { kind: target.kind, path: target.path, action: 'created' };
  if (prior === undefined) return { kind: target.kind, path: target.path, action: 'added' };
  return { kind: target.kind, path: target.path, action: 'updated' };
};

export const runSetupMcp = (opts: SetupMcpOptions = {}): TargetResult[] => {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const entry = buildEntry(opts.style ?? 'npx');
  const targets = resolveTargets(cwd, opts);
  if (targets.length === 0) {
    throw new Error('no targets selected — drop --no-project / --no-vscode');
  }
  return targets.map((t) => writeMcpConfig(t, entry, opts.force === true));
};

const describeAction = (r: TargetResult): string => {
  switch (r.action) {
    case 'created':
      return chalk.green('created');
    case 'added':
      return chalk.green('added');
    case 'updated':
      return chalk.yellow('updated');
    case 'unchanged':
      return chalk.gray('unchanged');
    case 'skipped':
      return chalk.yellow('skipped');
  }
};

export const registerSetupMcp = (setup: Command): void => {
  setup
    .command('mcp')
    .description('Wire the Agentage MCP shim into MCP client configs in the current directory')
    .option('--style <style>', 'Command style: `npx` (default) or `binary` for direct agentage-mcp')
    .option('--force', 'Overwrite an existing `agentage` entry that differs from the generated one')
    .option('--no-project', 'Skip .mcp.json (Claude Code project scope)')
    .option('--no-vscode', 'Skip .vscode/mcp.json (VSCode workspace)')
    .option('--json', 'JSON output')
    .action((opts: SetupMcpOptions) => {
      const style: McpCommandStyle = opts.style === 'binary' ? 'binary' : 'npx';
      const results = runSetupMcp({ ...opts, style });

      if (opts.json) {
        console.log(JSON.stringify({ cwd: process.cwd(), style, results }, null, 2));
        return;
      }

      for (const r of results) {
        const label = r.kind === 'vscode-workspace' ? 'vscode' : 'claude-code';
        console.log(`${describeAction(r).padEnd(20)} ${label}  ${chalk.dim(r.path)}`);
        if (r.reason) console.log(`  ${chalk.dim(r.reason)}`);
      }
    });
};
