import { type Command } from 'commander';
import { type SignInOptions, type SignInResult } from '../../lib/auth/sign-in.js';

export interface SetupOptions extends SignInOptions {
  disconnect?: boolean;
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

export const registerSetup = (
  program: Command,
  action: (opts: SetupOptions) => Promise<void>
): void => {
  program
    .command('setup')
    .description('Sign in and connect this machine to your agentage account')
    .option('--disconnect', 'sign out and remove local credentials')
    .option('--reauth', 'force a fresh sign-in')
    .option('--no-browser', 'print the sign-in URL instead of opening a browser')
    .action(action);
};
