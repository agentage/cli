// Types for an extension's entry; at runtime an extension gets everything through ctx, never this.
import { type Command } from 'commander';

// The extension contract is versioned apart from the CLI, so extensions pin it, not a CLI release.
export const EXTENSION_API_VERSION = '1.0.0';

export type ConfigType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ConfigurationEntry {
  type: ConfigType;
  default?: unknown;
  // Shown after the key when setup asks for a secret.
  description?: string;
  // The only values allowed; any other makes the extension invalid, naming the key.
  enum?: unknown[];
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

// Empty here; an extension adds its peers' APIs by id (declaration merging), and `use` types them.
export interface ExtensionApis {}

export interface ExtensionUse {
  <K extends keyof ExtensionApis>(id: K, options?: { optional?: false }): ExtensionApis[K];
  <K extends keyof ExtensionApis>(id: K, options: { optional: true }): ExtensionApis[K] | undefined;
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

// Only while register runs: afterwards add throws "registration closed".
export interface ExtensionCommands {
  add: (...registrars: CommandRegistrar[]) => void;
}

// Only while register runs, like commands.add.
export interface ExtensionSubscriptions {
  push: (...disposables: Disposable[]) => void;
}

// `test` only from createTestContext in @agentage/cli/extension/test.
export type ExtensionMode = 'installed' | 'dev' | 'test';

// The only core surface. Not a sandbox: an extension runs in the CLI process with your privileges.
export interface ExtensionContext {
  readonly id: string;
  readonly version: string;
  // The version that last loaded ok on this machine; null on the first load.
  readonly previousVersion: string | null;
  readonly mode: ExtensionMode;
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
