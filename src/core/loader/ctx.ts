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
import { readRunState } from './state.js';

export interface StagedContext {
  ctx: ExtensionContext;
  // The extension's own Command: what its commands.add() registers lands here, never on the CLI.
  program: Command;
  subscriptions: Disposable[];
  revoke: () => void;
  // Called once register resolved: commands.add and subscriptions.push throw from then on.
  close: () => void;
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

interface Gates {
  live: Live;
  // Live, and only until registration closes.
  staging: Live;
  revoke: () => void;
  close: () => void;
}

const gate = (fail: () => string): { pass: Live; shut: () => void } => {
  let shut = false;
  const pass: Live =
    (fn) =>
    (...args) => {
      if (shut) throw new Error(fail());
      return fn(...args);
    };
  return { pass, shut: () => void (shut = true) };
};

const gates = (id: string): Gates => {
  const revoked = gate(() => `the context of extension ${id} was revoked`);
  const closed = gate(
    () => `registration closed: ${id} adds commands and subscriptions in register`
  );
  return {
    live: revoked.pass,
    staging: (fn) => revoked.pass(closed.pass(fn)),
    revoke: revoked.shut,
    close: closed.shut,
  };
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
    previousVersion: readRunState(id)?.lastOk ?? null,
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
  const { live, staging, revoke, close } = gates(ext.id ?? '');
  const program = new Command(template.name()).copyInheritedSettings(template);
  const subscriptions: Disposable[] = [];
  const add = (...fns: CommandRegistrar[]) => addCommands(ext, program, fns);
  const push = (...items: Disposable[]) => void subscriptions.push(...items);
  const ctx = contextOf(ext, live, {
    commands: Object.freeze({ add: staging(add) }),
    use: live(use) as ExtensionUse,
    subscriptions: Object.freeze({ push: staging(push) }),
  });
  return { ctx, program, subscriptions, revoke, close };
};
