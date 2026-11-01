import { type Command } from 'commander';
import { extensionsEnabled } from '../../core/flag.js';
import { type SignInOptions, type SignInResult } from '../../lib/auth/sign-in.js';

export interface SetupOptions extends SignInOptions {
  disconnect?: boolean;
  // Registered only with AGENTAGE_EXTENSIONS=1.
  profile?: string;
  dryRun?: boolean;
  check?: boolean;
  json?: boolean;
}

// printStatus comes from the program root, so this command never imports the status command.
export interface SetupDeps {
  ensureSignedIn: (opts: SignInOptions) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  // `token` stands in for AGENTAGE_TOKEN once loading extensions removed it from the environment.
  printStatus: (opts?: { token?: string }) => Promise<void>;
}

export const runSetup = async (opts: SetupOptions, deps: SetupDeps): Promise<void> => {
  if (opts.disconnect) return deps.signOut();
  await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser });
  await deps.printStatus();
};

const EXTENSIONS_HELP = `
Extensions: --profile <file> validates a profile (schema v1), saves it as profile.json and
installs its extensions with npm, without signing in. --dry-run prints the plan, what setup
would change (+ add, ~ update, - remove, o off, then one summary line), and writes nothing;
--check prints the plan and exits 1 when anything would change, the lock in the extensions
directory does not match the installed tree, or machine.json is missing; it writes nothing.
Neither signs in. Plain setup signs in, then pulls the profile from your account (creating it
from this machine's profile.json, or the default, when the account has none), registers this
machine in the account and installs; it never pushes a change. When the account cannot be
reached it installs from the local profile.json. A profile from --profile stays local: setup
neither pulls nor pushes it. Each package comes from the registry the profile's
registries map names for its scope (default https://registry.npmjs.org) into
AGENTAGE_EXTENSIONS_DIR (default ~/.agentage/extensions). After installing, setup lists the
secrets extensions declare and this machine has not set (asking for them on a terminal), then
loads every extension once and prints ok or failed for each; it exits 1 when any failed.
Signed in to another account than the one this machine is connected to, setup exits 1; run
setup --disconnect first, which also marks this machine disconnected in your account.`;

export const registerSetup = (
  program: Command,
  action: (opts: SetupOptions) => Promise<void>
): void => {
  const command = program
    .command('setup')
    .description('Sign in and connect this machine to your agentage account')
    .option('--disconnect', 'sign out and remove local credentials')
    .option('--reauth', 'force a fresh sign-in')
    .option('--no-browser', 'print the sign-in URL instead of opening a browser')
    .action(action);
  if (!extensionsEnabled()) return;
  command
    .option('--profile <file>', 'install the extensions a profile file names; never signs in')
    .option('--dry-run', 'print what setup would change and write nothing')
    .option('--check', 'exit 1 when setup would change anything; write nothing')
    .option('--json', 'with --dry-run or --check: the plan as JSON')
    .addHelpText('after', EXTENSIONS_HELP);
};
