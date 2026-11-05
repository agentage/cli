import { Command } from 'commander';
import { type DiscoveredExtension } from './discover.js';
import { disposeAll, holdSignals } from './dispose.js';
import { loadOrder } from './order.js';
import { registerExtension, registerTimeoutMs, type LoadedExtension } from './register.js';
import { writeRunState } from './state.js';
import { withTimeout } from './timeout.js';
import { createUse } from './use.js';

// A kit-shaped extension's code runs in the kit: null when its command entry is right, else why.
export type KitCheck = (dir: string) => Promise<string | null>;

const noKitCheck: KitCheck = async () => 'no kit check in this command';

export interface LoadOutcome {
  state: 'ok' | 'failed' | 'blocked';
  error: string | null;
}

export interface LoadSession {
  // By package name: every extension the loader tried.
  outcomes: Map<string, LoadOutcome>;
  // By id, in load order: the extensions whose register succeeded.
  loaded: Map<string, LoadedExtension>;
  // Disposes every subscription once, and releases SIGINT and SIGTERM.
  dispose: () => Promise<void>;
}

const blockedBy = (ext: DiscoveredExtension, outcomes: Map<string, LoadOutcome>): string | null => {
  const required = ext.peers.filter((peer) => !ext.optionalPeers.includes(peer));
  const peer = required.find((name) => outcomes.get(name)?.state !== 'ok');
  return peer === undefined ? null : `peer ${peer} is ${outcomes.get(peer)?.state ?? 'not loaded'}`;
};

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// The kit imports the entry, so its top-level code counts toward the same timeout as register.
const checkKit = async (ext: DiscoveredExtension, check: KitCheck): Promise<LoadOutcome> => {
  if (ext.entry === null) return { state: 'ok', error: null };
  try {
    const problem = await withTimeout(check(ext.dir), registerTimeoutMs());
    return problem === null ? { state: 'ok', error: null } : { state: 'failed', error: problem };
  } catch (err) {
    return { state: 'failed', error: messageOf(err) };
  }
};

const attempt = async (
  ext: DiscoveredExtension,
  session: LoadSession,
  template: Command,
  check: KitCheck
): Promise<LoadOutcome> => {
  const blocked = blockedBy(ext, session.outcomes);
  if (blocked) return { state: 'blocked', error: blocked };
  if (ext.kind === 'kit') return checkKit(ext, check);
  const result = await registerExtension(ext, createUse(ext, session.loaded), template);
  if (!result.ok) return { state: 'failed', error: result.error };
  session.loaded.set(ext.id ?? '', result.loaded);
  return { state: 'ok', error: null };
};

// What an extension prints while it loads goes to stderr, so stdout stays the command's own.
const toStderr = async (fn: () => Promise<void>): Promise<void> => {
  const saved = { log: console.log, info: console.info, debug: console.debug };
  console.log = console.info = console.debug = console.error;
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
};

const newSession = (): LoadSession => {
  const loaded = new Map<string, LoadedExtension>();
  let disposed: Promise<unknown> | undefined;
  const disposeOnce = async (): Promise<void> => {
    disposed ??= Promise.all(
      [...loaded.values()].map((l) => disposeAll(l.ext.id ?? '', l.subscriptions))
    );
    await disposed;
  };
  const release = holdSignals(disposeOnce);
  const dispose = (): Promise<void> => {
    release();
    return disposeOnce();
  };
  return { outcomes: new Map(), loaded, dispose };
};

// Loads in peer order; one extension failing never stops the others, only what depends on it.
export const loadExtensions = async (
  extensions: DiscoveredExtension[],
  template: Command = new Command('agentage'),
  check: KitCheck = noKitCheck
): Promise<LoadSession> => {
  // Not a sandbox, but the token never reaches extension code through the environment.
  delete process.env['AGENTAGE_TOKEN'];
  const session = newSession();
  await toStderr(async () => {
    for (const ext of loadOrder(extensions)) {
      const outcome = await attempt(ext, session, template, check);
      session.outcomes.set(ext.pkg, outcome);
      writeRunState(ext.id ?? '', { ...outcome, version: ext.version });
    }
  });
  return session;
};
