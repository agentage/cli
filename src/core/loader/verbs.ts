import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { commandsPath } from '../paths.js';
import { type DiscoveredExtension } from './discover.js';
import { CORE_COMMANDS } from './manifest.js';

// A command of a kit-shaped extension that runs only as `agentage {id} {name}`.
export interface Namespaced {
  pkg: string;
  id: string;
  name: string;
  // Why `agentage {name}` is not it, e.g. "is a core command".
  why: string;
}

export interface Verbs {
  // `agentage {name}` -> the package whose command it runs.
  top: Map<string, string>;
  namespaced: Namespaced[];
}

const isHeld = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((pkg) => typeof pkg === 'string');

// Who held each top-level verb after the last install; absent or unreadable: nobody.
export const readHeld = (): Map<string, string> =>
  new Map(Object.entries(readJson(commandsPath(), isHeld) ?? {}));

// Written only when it changed, so a machine without kit commands never gets the file.
export const writeHeld = (top: Map<string, string>): void => {
  const next = Object.fromEntries(top);
  const current = Object.fromEntries(readHeld());
  if (isDeepStrictEqual(next, current)) return;
  mkdirSync(dirname(commandsPath()), { recursive: true, mode: 0o700 });
  writeJsonAtomic(commandsPath(), next);
};

// Core commands and every extension id are namespaces; 1.0 commands are named after their id.
const takenNames = (extensions: DiscoveredExtension[]): Map<string, string> => {
  const taken = new Map(CORE_COMMANDS.map((name) => [name, 'is a core command']));
  for (const ext of extensions.filter((e) => e.id !== null)) {
    const why = `is taken by extension ${ext.id}`;
    taken.set(ext.id ?? '', why);
    if (ext.kind === 'api') for (const name of ext.commands) taken.set(name, why);
  }
  return taken;
};

type Ids = Map<string, string>;

const whyNot = (name: string, taken: Map<string, string>, top: Map<string, string>, ids: Ids) =>
  taken.get(name) ?? `is taken by extension ${ids.get(top.get(name) ?? '') ?? '?'}`;

const namespacedOf = (kit: DiscoveredExtension[], taken: Map<string, string>, top: Ids) => {
  const ids: Ids = new Map(kit.map((ext) => [ext.pkg, ext.id ?? '']));
  return kit.flatMap((ext) =>
    ext.commands
      .filter((name) => top.get(name) !== ext.pkg)
      .map((name) => ({ pkg: ext.pkg, id: ext.id ?? '', name, why: whyNot(name, taken, top, ids) }))
  );
};

// An earlier holder keeps its verb; a later claimant runs only as `agentage {id} {name}`.
export const claimVerbs = (extensions: DiscoveredExtension[], held: Map<string, string>): Verbs => {
  const kit = extensions.filter((ext) => ext.kind === 'kit' && ext.id !== null);
  const taken = takenNames(extensions);
  const top = new Map<string, string>();
  const claim = (name: string, pkg: string): void => {
    if (!taken.has(name) && !top.has(name)) top.set(name, pkg);
  };
  for (const [name, pkg] of held)
    if (kit.some((ext) => ext.pkg === pkg && ext.commands.includes(name))) claim(name, pkg);
  for (const ext of kit) for (const name of ext.commands) claim(name, ext.pkg);
  return { top, namespaced: namespacedOf(kit, taken, top) };
};

// What `extension list` shows: a namespaced command as `{id} {name}`, any other as it is.
export const commandNames = (ext: DiscoveredExtension, verbs: Verbs): string[] =>
  ext.commands.map((name) =>
    verbs.namespaced.some((n) => n.pkg === ext.pkg && n.name === name) ? `${ext.id} ${name}` : name
  );
