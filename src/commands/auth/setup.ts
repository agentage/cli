import { type Command } from 'commander';
import { extensionsEnabled } from '../../core/flag.js';
import { type SignInOptions, type SignInResult } from '../../lib/auth/sign-in.js';

export interface SetupOptions extends SignInOptions {
  disconnect?: boolean;
  // Registered only with AGENTAGE_EXTENSIONS=1.
  profile?: string;
  dryRun?: boolean;
}

// printStatus comes from the program root, so this command never imports the status command.
export interface SetupDeps {
  ensureSignedIn: (opts: SignInOptions) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  printStatus: () => Promise<void>;
}

export const runSetup = async (opts: SetupOptions, deps: SetupDeps): Promise<void> => {
  if (opts.disconnect) return deps.signOut();
  await deps.ensureSignedIn({ reauth: opts.reauth, browser: opts.browser });
  await deps.printStatus();
};

const EXTENSIONS_HELP = `
Extensions: --profile <file> validates a profile (schema v1), saves it as profile.json and
installs its extensions with npm, without signing in; --dry-run prints the install plan and
writes nothing. Plain setup signs in, then installs from the local profile.json (or the
default profile when there is none). Packages come from AGENTAGE_NPM_REGISTRY (default
https://registry.npmjs.org) into AGENTAGE_EXTENSIONS_DIR (default ~/.agentage/extensions);
only @agentage packages are installed unless AGENTAGE_EXTENSION_SCOPES widens the scopes.`;

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
    .option('--dry-run', 'print the install plan and write nothing')
    .addHelpText('after', EXTENSIONS_HELP);
};
