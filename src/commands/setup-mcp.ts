import { type Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import chalk from 'chalk';

export type McpCommandStyle = 'npx' | 'binary';
export type McpScope = 'project' | 'user' | 'all';

interface McpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
}

interface McpConfigFile {
  kind: 'claude-code-project' | 'vscode-workspace' | 'claude-code-user';
  path: string;
  /** Top-level key under which MCP servers live in this client's config. */
  key: 'mcpServers' | 'servers';
}

export interface SetupMcpOptions {
  cwd?: string;
  home?: string;
  scope?: McpScope;
  style?: McpCommandStyle;
  force?: boolean;
  noProject?: boolean;
  noVscode?: boolean;
  json?: boolean;
}

export interface TargetResult {
  kind: McpConfigFile['kind'];
  path: string;
  action: 'created' | 'added' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
}

const buildEntry = (style: McpCommandStyle): McpServerEntry =>
  style === 'binary'
    ? { type: 'stdio', command: 'agentage-mcp', args: [] }
    : { type: 'stdio', command: 'npx', args: ['-y', '@agentage/mcp'] };

const resolveTargets = (cwd: string, home: string, opts: SetupMcpOptions): McpConfigFile[] => {
  const scope: McpScope = opts.scope ?? 'project';
  const wantProject = scope === 'project' || scope === 'all';
  const wantUser = scope === 'user' || scope === 'all';
  const targets: McpConfigFile[] = [];
  if (wantProject && !opts.noProject) {
    targets.push({
      kind: 'claude-code-project',
      path: join(cwd, '.mcp.json'),
      key: 'mcpServers',
    });
  }
  if (wantProject && !opts.noVscode) {
    targets.push({
      kind: 'vscode-workspace',
      path: join(cwd, '.vscode', 'mcp.json'),
      key: 'servers',
    });
  }
  if (wantUser) {
    targets.push({
      kind: 'claude-code-user',
      path: join(home, '.claude.json'),
      key: 'mcpServers',
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
  const home = resolve(opts.home ?? homedir());
  const entry = buildEntry(opts.style ?? 'npx');
  const targets = resolveTargets(cwd, home, opts);
  if (targets.length === 0) {
    throw new Error(
      'no targets selected — check --scope (project|user|all) and --no-project / --no-vscode'
    );
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

const targetLabel = (kind: McpConfigFile['kind']): string => {
  switch (kind) {
    case 'claude-code-project':
      return 'claude-code (project)';
    case 'vscode-workspace':
      return 'vscode (workspace)';
    case 'claude-code-user':
      return 'claude-code (user)';
  }
};

export const printMcpResults = (results: TargetResult[]): void => {
  for (const r of results) {
    console.log(
      `${describeAction(r).padEnd(20)} ${targetLabel(r.kind).padEnd(22)} ${chalk.dim(r.path)}`
    );
    if (r.reason) console.log(`  ${chalk.dim(r.reason)}`);
  }
};

export const registerSetupMcp = (setup: Command): void => {
  setup
    .command('mcp')
    .description(
      'Wire the Agentage MCP shim into MCP client configs. Defaults to project scope (cwd).'
    )
    .option(
      '--scope <scope>',
      'Which configs to write: `project` (default: cwd .mcp.json + .vscode/mcp.json), `user` (~/.claude.json), or `all`'
    )
    .option('--style <style>', 'Command style: `npx` (default) or `binary` for direct agentage-mcp')
    .option('--force', 'Overwrite an existing `agentage` entry that differs from the generated one')
    .option('--no-project', 'In `project`/`all` scope, skip .mcp.json (Claude Code project)')
    .option('--no-vscode', 'In `project`/`all` scope, skip .vscode/mcp.json (VSCode workspace)')
    .option('--json', 'JSON output')
    .action((opts: SetupMcpOptions) => {
      const style: McpCommandStyle = opts.style === 'binary' ? 'binary' : 'npx';
      const scope: McpScope =
        opts.scope === 'user' || opts.scope === 'all' ? opts.scope : 'project';
      const results = runSetupMcp({ ...opts, style, scope });

      if (opts.json) {
        console.log(JSON.stringify({ cwd: process.cwd(), scope, style, results }, null, 2));
        return;
      }

      printMcpResults(results);
    });
};
