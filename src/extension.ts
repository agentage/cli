// Types for an extension's entry; at runtime an extension gets everything through ctx, never this.
import { type Command } from 'commander';

// The extension contract is versioned apart from the CLI, so extensions pin it, not a CLI release.
export const EXTENSION_API_VERSION = '1.0.0';

export type ConfigType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ConfigurationEntry {
  type: ConfigType;
  default?: unknown;
  // Never in the profile: set on each machine, read through ctx.secrets.
  secret?: boolean;
  scope?: 'shared' | 'machine';
}

// The `package.json` fields the core reads, as data, before any code runs.
export interface ExtensionManifest {
  name: string;
  version: string;
  keywords?: string[];
  engines?: { agentage?: string };
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  agentage: {
    id: string;
    contributes?: { commands?: string[] };
    configuration?: Record<string, ConfigurationEntry>;
  };
}

export interface Disposable {
  dispose: () => void | Promise<void>;
}

// What `register` returns for its dependents: a plain object of functions.
export type ExtensionApi = Readonly<Record<string, (...args: never[]) => unknown>>;

export interface ExtensionUse {
  (id: string, options?: { optional?: false }): ExtensionApi;
  (id: string, options: { optional: true }): ExtensionApi | undefined;
}

export interface ExtensionSecrets {
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

// One JSON line per call in logs/<id>.log.
export type ExtensionLog = (message: string, fields?: Record<string, unknown>) => void;

// Adds commands named `<id>` or `<id>:<name>` that agentage.contributes.commands lists.
export type CommandRegistrar = (program: Command) => void;

export interface ExtensionCommands {
  add: (...registrars: CommandRegistrar[]) => void;
}

export interface ExtensionSubscriptions {
  push: (...disposables: Disposable[]) => void;
}

// The only core surface. Not a sandbox: an extension runs in the CLI process with your privileges.
export interface ExtensionContext {
  readonly id: string;
  readonly version: string;
  readonly mode: 'installed' | 'dev';
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets: ExtensionSecrets;
  readonly data: string;
  readonly cache: string;
  readonly log: ExtensionLog;
  readonly commands: ExtensionCommands;
  readonly use: ExtensionUse;
  readonly subscriptions: ExtensionSubscriptions;
}

export type Register = (
  ctx: ExtensionContext
) => ExtensionApi | void | Promise<ExtensionApi | void>;

export interface Extension {
  register: Register;
}

// Identity at runtime: it only gives an entry its types.
export const defineExtension = <T extends Extension>(extension: T): T => extension;
