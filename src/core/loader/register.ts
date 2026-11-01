import { pathToFileURL } from 'node:url';
import { type Command } from 'commander';
import {
  type Disposable,
  type ExtensionApi,
  type ExtensionContext,
  type ExtensionUse,
  type Register,
} from '../../extension.js';
import { isRecord } from '../../lib/fs/json-file.js';
import { createContext } from './ctx.js';
import { type DiscoveredExtension } from './discover.js';
import { disposeAll } from './dispose.js';
import { withTimeout } from './timeout.js';
import { facadeOf } from './use.js';

export const DEFAULT_REGISTER_TIMEOUT_MS = 10_000;

export interface LoadedExtension {
  ext: DiscoveredExtension;
  // The commands it added, committed only because its register succeeded.
  program: Command;
  subscriptions: Disposable[];
  facade: ExtensionApi;
}

export type Attempt = { ok: true; loaded: LoadedExtension } | { ok: false; error: string };

// Tests shorten the wait; anything but a positive integer keeps the default.
export const registerTimeoutMs = (): number => {
  const raw = process.env['AGENTAGE_REGISTER_TIMEOUT_MS'] ?? '';
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : DEFAULT_REGISTER_TIMEOUT_MS;
};

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const isRegister = (value: unknown): value is Register => typeof value === 'function';

const importAndRegister = async (entry: string, ctx: ExtensionContext): Promise<unknown> => {
  const exported: unknown = await import(pathToFileURL(entry).href);
  const register = isRecord(exported) ? exported['register'] : undefined;
  if (!isRegister(register)) throw new Error('the entry exports no register function');
  return register(ctx);
};

// The import counts toward the timeout too: a top-level await can hang like register can.
export const registerExtension = async (
  ext: DiscoveredExtension,
  use: ExtensionUse,
  template: Command
): Promise<Attempt> => {
  const staged = createContext({ ext, use, template });
  try {
    const api = await withTimeout(
      importAndRegister(ext.entry ?? '', staged.ctx),
      registerTimeoutMs()
    );
    const { program, subscriptions } = staged;
    return { ok: true, loaded: { ext, program, subscriptions, facade: facadeOf(api) } };
  } catch (err) {
    staged.revoke();
    await disposeAll(ext.id ?? '', staged.subscriptions);
    return { ok: false, error: messageOf(err) };
  }
};
