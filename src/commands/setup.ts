import { type Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import open from 'open';
import {
  loadConfig,
  saveConfig,
  getConfigDir,
  type DaemonConfig,
  type MachineIdentity,
} from '../daemon/config.js';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { readAuth, saveAuth, deleteAuth, type AuthState } from '../hub/auth.js';
import { startCallbackServer, getCallbackPort } from '../hub/auth-callback.js';
import { createHubClient } from '../hub/hub-client.js';
import {
  printMcpResults,
  registerSetupMcp,
  runSetupMcp,
  type McpCommandStyle,
  type TargetResult,
} from './setup-mcp.js';

const DEFAULT_HUB_URL = 'https://agentage.io';

export interface SetupOptions {
  hub?: string;
  name?: string;
  dir?: string;
  machineId?: string;
  token?: string;
  reauth?: boolean;
  disconnect?: boolean;
  login?: boolean;
  yes?: boolean;
  interactive?: boolean;
  force?: boolean;
  json?: boolean;
  mcp?: boolean;
  mcpStyle?: McpCommandStyle;
}

type SetupMode = 'fresh' | 'reauth' | 'disconnect' | 'standalone' | 'idempotent';

const normalizeHubUrl = (url: string): string =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;

const machineJsonPath = (): string => join(getConfigDir(), 'machine.json');

const readMachineJson = (): MachineIdentity | undefined => {
  const path = machineJsonPath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<MachineIdentity>;
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const writeMachineJson = (identity: MachineIdentity): void => {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(machineJsonPath(), JSON.stringify(identity, null, 2) + '\n', 'utf-8');
};

const ensureMachineIdentity = (opts: SetupOptions): void => {
  const existing = readMachineJson();

  if (existing && opts.name && existing.name !== opts.name && !opts.force) {
    console.error(
      chalk.red(`Error: machine.json already has name "${existing.name}". Pass --force to rename.`)
    );
    process.exit(7);
    return;
  }

  if (existing && opts.machineId && existing.id !== opts.machineId && !opts.force) {
    console.error(
      chalk.red(`Error: machine.json already has id "${existing.id}". Pass --force to overwrite.`)
    );
    process.exit(7);
    return;
  }

  const id = opts.machineId ?? existing?.id ?? randomUUID();
  const name = opts.name ?? existing?.name ?? hostname();

  if (!existing || existing.id !== id || existing.name !== name) {
    writeMachineJson({ id, name });
  }
};

const mergeConfig = (opts: SetupOptions): DaemonConfig => {
  const config = loadConfig();

  if (opts.hub) {
    config.hub = { url: normalizeHubUrl(opts.hub) };
  } else if (!config.hub) {
    config.hub = { url: DEFAULT_HUB_URL };
  }

  if (opts.dir) {
    const absolute = resolve(opts.dir);
    if (config.agents.default !== absolute && !config.agents.additional.includes(absolute)) {
      config.agents.additional.push(absolute);
    }
  }

  if (opts.name) {
    config.machine.name = opts.name;
  }

  return config;
};

const confirmConnect = async (config: DaemonConfig): Promise<boolean> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const hub = config.hub?.url ?? DEFAULT_HUB_URL;
    const ans = (await rl.question(`Connect machine "${config.machine.name}" to ${hub} ? [Y/n] `))
      .trim()
      .toLowerCase();
    if (ans === '' || ans === 'y' || ans === 'yes') return true;
    if (ans === 'n' || ans === 'no') return false;
    const ans2 = (await rl.question(`Please answer 'y' or 'n': `)).trim().toLowerCase();
    return ans2 === '' || ans2 === 'y' || ans2 === 'yes';
  } finally {
    rl.close();
  }
};

const doAuthBrowser = async (hubUrl: string, machineId: string): Promise<void> => {
  console.log('Opening browser for authentication...');

  const authPromise = startCallbackServer(hubUrl);
  await new Promise((r) => setTimeout(r, 100));
  const port = getCallbackPort();

  if (!port) {
    console.error(chalk.red('Failed to start callback server'));
    process.exit(4);
    return;
  }

  const authUrl = `${hubUrl}/login?cli_port=${port}`;

  try {
    await open(authUrl);
  } catch {
    console.log(chalk.yellow('Could not open browser. Open this URL manually:'));
    console.log(authUrl);
  }

  console.log('Waiting for login...');

  try {
    const authState = await authPromise;
    authState.hub.url = hubUrl;
    authState.hub.machineId = machineId;
    saveAuth(authState);
  } catch (err) {
    console.error(chalk.red(`Login failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(4);
  }
};

const doAuthToken = (token: string, hubUrl: string, machineId: string): void => {
  console.log(chalk.yellow('Direct token login — skipping browser flow'));
  console.log(
    chalk.yellow('Note: refresh tokens are not available in direct mode. Session will expire.')
  );

  const authState: AuthState = {
    session: {
      access_token: token,
      refresh_token: '',
      expires_at: 0,
    },
    user: { id: '', email: '' },
    hub: { url: hubUrl, machineId },
  };
  saveAuth(authState);
};

const doDisconnect = async (opts: SetupOptions): Promise<void> => {
  await ensureDaemon();
  const auth = readAuth();

  if (!auth) {
    if (opts.json) {
      console.log(
        JSON.stringify({ ok: true, mode: 'disconnect', alreadyDisconnected: true }, null, 2)
      );
    } else {
      console.log(chalk.yellow('Not logged in.'));
    }
    return;
  }

  try {
    const client = createHubClient(auth.hub.url, auth);
    await client.deregister(auth.hub.machineId);
  } catch {
    // Hub unreachable — continue with local cleanup
  }

  deleteAuth();

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, mode: 'disconnect' }, null, 2));
  } else {
    console.log(chalk.green('Disconnected from hub. Machine deregistered.'));
    console.log(chalk.dim('Daemon continues running in standalone mode.'));
    console.log(chalk.dim('Run `agentage daemon restart` to apply.'));
  }
};

const printIdempotent = (
  config: DaemonConfig,
  auth: AuthState | null,
  opts: SetupOptions
): void => {
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'idempotent',
          machine: { id: config.machine.id, name: config.machine.name },
          hub: {
            url: auth?.hub?.url ?? config.hub?.url ?? null,
            connected: !!auth,
            userEmail: auth?.user?.email ?? null,
          },
          agentsDir: config.agents.default,
        },
        null,
        2
      )
    );
    return;
  }
  console.log(chalk.yellow('Already configured:'));
  console.log(`  Machine:    ${config.machine.name} (${config.machine.id.slice(0, 8)})`);
  console.log(`  Hub:        ${auth?.hub?.url ?? config.hub?.url ?? '(none)'}`);
  console.log(`  User:       ${auth?.user?.email ?? '(none)'}`);
  console.log(
    chalk.dim(
      '\nRun `agentage setup --reauth` to re-login or `agentage setup --disconnect` to remove.'
    )
  );
};

const printSummary = (
  config: DaemonConfig,
  mode: SetupMode,
  userEmail: string | null,
  opts: SetupOptions,
  mcp: TargetResult[] | null
): void => {
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          machine: { id: config.machine.id, name: config.machine.name },
          hub: {
            url: config.hub?.url ?? null,
            connected: mode !== 'standalone' && userEmail !== null,
            userEmail,
          },
          agentsDir: config.agents.default,
          mcp,
        },
        null,
        2
      )
    );
    return;
  }
  console.log(chalk.green('Agentage configured:'));
  console.log(`  Machine:    ${config.machine.name} (${config.machine.id.slice(0, 8)})`);
  console.log(`  Hub:        ${config.hub?.url ?? '(none)'}`);
  console.log(`  Agents dir: ${config.agents.default}`);
  if (userEmail) console.log(`  User:       ${userEmail}`);
  if (mcp && mcp.length > 0) {
    console.log(chalk.bold('\nMCP clients:'));
    printMcpResults(mcp);
  }
  if (mode === 'standalone') {
    console.log(chalk.dim('\nStandalone mode — run `agentage setup --reauth` to connect to hub.'));
  } else {
    console.log(chalk.dim('\nRun `agentage status` to see daemon and hub state.'));
  }
};

export const runSetup = async (opts: SetupOptions): Promise<void> => {
  if (opts.reauth && opts.disconnect) {
    console.error(chalk.red('Error: --reauth and --disconnect cannot be combined.'));
    process.exit(3);
    return;
  }

  if (opts.disconnect) {
    await doDisconnect(opts);
    process.exit(0);
    return;
  }

  const wantsAuth = opts.login !== false;
  const interactive = opts.interactive !== false;
  const isTty = !!process.stdout.isTTY;

  // Idempotent: existing auth and no explicit re-setup intent
  const existingAuth = readAuth();
  const explicitChange =
    opts.reauth || opts.token || opts.machineId || opts.name || opts.hub || opts.dir;
  if (existingAuth && !explicitChange && wantsAuth) {
    printIdempotent(loadConfig(), existingAuth, opts);
    process.exit(0);
    return;
  }

  // Non-interactive guard for browser auth
  if (wantsAuth && !opts.token && (!interactive || !isTty)) {
    console.error(
      chalk.red('Error: cannot prompt for login (not a TTY). Pass --token <t> or --no-login.')
    );
    process.exit(2);
    return;
  }

  ensureMachineIdentity(opts);
  const config = mergeConfig(opts);
  saveConfig(config);

  const skipConfirm = !!(
    opts.yes ||
    opts.token ||
    opts.reauth ||
    !isTty ||
    opts.interactive === false
  );

  if (!skipConfirm) {
    const ok = await confirmConnect(config);
    if (!ok) {
      console.log(chalk.yellow('Aborted.'));
      process.exit(1);
      return;
    }
  }

  await ensureDaemon();

  let userEmail: string | null = null;
  const mode: SetupMode = !wantsAuth ? 'standalone' : opts.reauth ? 'reauth' : 'fresh';

  if (wantsAuth) {
    const hubUrl = config.hub!.url;
    if (opts.token) {
      doAuthToken(opts.token, hubUrl, config.machine.id);
    } else {
      await doAuthBrowser(hubUrl, config.machine.id);
    }
    userEmail = readAuth()?.user?.email ?? null;
  }

  // Wire user-scope MCP configs so Claude Code (any project) sees the daemon.
  // Only on fresh setup — reauth keeps existing MCP wiring, standalone skips
  // because we haven't proven daemon + auth yet.
  let mcp: TargetResult[] | null = null;
  if (mode === 'fresh' && opts.mcp !== false) {
    try {
      mcp = runSetupMcp({ scope: 'user', style: opts.mcpStyle ?? 'npx' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.yellow(`\nMCP wiring skipped: ${msg}`));
      console.error(chalk.dim('Run `agentage setup mcp --scope=user` manually if desired.'));
    }
  }

  printSummary(config, mode, userEmail, opts, mcp);
  process.exit(0);
};

export const registerSetup = (program: Command): void => {
  const setup = program
    .command('setup')
    .description('Configure machine, hub, and authentication')
    .option('--name <name>', 'Machine name (default: hostname)')
    .option('--machine-id <uuid>', 'Pre-assign machine identity (cloud-init)')
    .option('--hub <url>', 'Hub URL (default: https://agentage.io)')
    .option('--dir <path>', 'Agents directory')
    .option('--token <token>', 'Headless: use access token directly, skip browser')
    .option('--reauth', 'Re-run OAuth keeping existing config')
    .option('--disconnect', 'Deregister + delete auth.json')
    .option('--no-login', 'Configure but do not authenticate (standalone mode)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--no-interactive', 'Refuse to prompt; error if input would be needed')
    .option('--force', 'Overwrite existing machine identity on rename')
    .option('--no-mcp', 'Skip the user-scope MCP wiring stage (~/.claude.json). Fresh mode only.')
    .option('--mcp-style <style>', 'MCP command style: `npx` (default) or `binary`')
    .option('--json', 'JSON output')
    .action(async (opts: SetupOptions) => {
      await runSetup(opts);
    });

  registerSetupMcp(setup);
};
