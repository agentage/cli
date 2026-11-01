import { Command } from 'commander';
import {
  type CommandRegistrar,
  type Disposable,
  type ExtensionCommands,
  type ExtensionContext,
  type ExtensionSecrets,
  type ExtensionSubscriptions,
  type ExtensionUse,
} from '../../extension.js';
import { cacheDir, dataDir } from '../paths.js';
import { type DiscoveredExtension } from './discover.js';
import { extensionLog } from './log.js';
import { secretsFor } from './secrets.js';

export interface StagedContext {
  ctx: ExtensionContext;
  // The extension's own Command: what its commands.add() registers lands here, never on the CLI.
  program: Command;
  subscriptions: Disposable[];
  revoke: () => void;
}

export interface ContextInput {
  ext: DiscoveredExtension;
  use: ExtensionUse;
  // Output and exit handling the extension's Command copies, e.g. from the CLI's own program.
  template: Command;
}

type Live = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;

interface Staged {
  commands: ExtensionCommands;
  use: ExtensionUse;
  subscriptions: ExtensionSubscriptions;
}

const revocable = (id: string): { live: Live; revoke: () => void } => {
  let revoked = false;
  const live: Live =
    (fn) =>
    (...args) => {
      if (revoked) throw new Error(`the context of extension ${id} was revoked`);
      return fn(...args);
    };
  return { live, revoke: () => void (revoked = true) };
};

// Run at once on the extension's Command, so a name it may not claim fails its register.
const addCommands = (ext: DiscoveredExtension, program: Command, fns: CommandRegistrar[]) => {
  for (const fn of fns) {
    const before = program.commands.length;
    fn(program);
    const added = program.commands.slice(before).map((command) => command.name());
    const stray = added.find((name) => !ext.commands.includes(name));
    if (stray) throw new Error(`command "${stray}" is not in agentage.contributes.commands`);
  }
};

const liveSecrets = (id: string, live: Live): ExtensionSecrets => {
  const secrets = secretsFor(id);
  return Object.freeze({
    get: live(secrets.get),
    set: live(secrets.set),
    delete: live(secrets.delete),
  });
};

const contextOf = (ext: DiscoveredExtension, live: Live, staged: Staged): ExtensionContext => {
  const id = ext.id ?? '';
  return Object.freeze({
    id,
    version: ext.version ?? '0.0.0',
    mode: ext.source === 'dev' ? 'dev' : 'installed',
    config: Object.freeze({ ...ext.config }),
    secrets: liveSecrets(id, live),
    data: dataDir(id),
    cache: cacheDir(id),
    log: live(extensionLog(id)),
    commands: staged.commands,
    use: staged.use,
    subscriptions: staged.subscriptions,
  });
};

// One per load attempt: on a throw or a timeout the loader revokes it, and every method throws.
export const createContext = ({ ext, use, template }: ContextInput): StagedContext => {
  const { live, revoke } = revocable(ext.id ?? '');
  const program = new Command(template.name()).copyInheritedSettings(template);
  const subscriptions: Disposable[] = [];
  const add = (...fns: CommandRegistrar[]) => addCommands(ext, program, fns);
  const push = (...items: Disposable[]) => void subscriptions.push(...items);
  const ctx = contextOf(ext, live, {
    commands: Object.freeze({ add: live(add) }),
    use: live(use) as ExtensionUse,
    subscriptions: Object.freeze({ push: live(push) }),
  });
  return { ctx, program, subscriptions, revoke };
};
