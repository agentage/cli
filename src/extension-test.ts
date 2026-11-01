/**
 * The `@agentage/cli/extension/test` subpath export: `createTestContext` builds the `ctx` an
 * extension's own unit tests hand to its `register`, over a temp dir, with `use` from fakes.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  type Disposable,
  type ExtensionApi,
  type ExtensionContext,
  type ExtensionSecrets,
  type ExtensionUse,
} from './extension.js';

export interface TestContextOverrides extends Partial<Omit<ExtensionContext, 'mode' | 'use'>> {
  // What ctx.use(id) returns, by peer id.
  use?: Record<string, ExtensionApi>;
  // Where ctx.commands.add registers commands; parse it to run them.
  program?: Command;
}

const memorySecrets = (): ExtensionSecrets => {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
};

const fakeUse = (fakes: Record<string, ExtensionApi>): ExtensionUse =>
  ((id: string, options: { optional?: boolean } = {}) => {
    const fake = fakes[id];
    if (fake !== undefined || options.optional) return fake;
    throw new Error(`use("${id}"): no fake for it in createTestContext({ use })`);
  }) as ExtensionUse;

// A fresh temp dir per context, laid out like the CLI's config dir.
const folders = (id: string) => {
  const root = mkdtempSync(join(tmpdir(), 'agentage-test-'));
  return { data: join(root, 'data', id), cache: join(root, 'cache', id) };
};

// Same members, in the same order, as the ctx the CLI builds; mode is always 'test'.
export const createTestContext = (overrides: TestContextOverrides = {}): ExtensionContext => {
  const { use = {}, program = new Command('agentage'), config = {}, ...rest } = overrides;
  const id = rest.id ?? 'test';
  const subscriptions: Disposable[] = [];
  const ctx: ExtensionContext = {
    id,
    version: '0.0.0',
    previousVersion: null,
    mode: 'test',
    config: Object.freeze({ ...config }),
    secrets: memorySecrets(),
    ...folders(id),
    log: () => undefined,
    commands: { add: (...registrars) => registrars.forEach((register) => register(program)) },
    use: fakeUse(use),
    subscriptions: { push: (...items) => void subscriptions.push(...items) },
    ...rest,
  };
  return Object.freeze(ctx);
};
