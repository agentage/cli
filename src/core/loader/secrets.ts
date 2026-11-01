import { type ExtensionSecrets } from '../../extension.js';
import { withFileLock } from '../../lib/fs/file-lock.js';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { secretsPath } from '../paths.js';
import { type DiscoveredExtension } from './discover.js';

// `{ "<id>": { "<key>": "<value>" } }`, 0600, never synced.
type SecretsFile = Record<string, Record<string, string>>;

export interface SecretKey {
  id: string;
  key: string;
}

const isStrings = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'string');

const isSecretsFile = (value: unknown): value is SecretsFile =>
  isRecord(value) && Object.values(value).every(isStrings);

const readSecrets = (): SecretsFile => readJson(secretsPath(), isSecretsFile) ?? {};

type Change = (own: Record<string, string>) => Record<string, string>;

// Re-read under the lock, so two processes never drop each other's secret.
const change = (id: string, fn: Change): Promise<void> =>
  withFileLock(secretsPath(), () => {
    const all = readSecrets();
    writeJsonAtomic(secretsPath(), { ...all, [id]: fn(all[id] ?? {}) });
  });

export const secretsFor = (id: string): ExtensionSecrets => ({
  get: async (key) => readSecrets()[id]?.[key],
  set: (key, value) => change(id, (own) => ({ ...own, [key]: value })),
  delete: (key) =>
    change(id, (own) => Object.fromEntries(Object.entries(own).filter(([k]) => k !== key))),
});

// The keys extensions declare `secret: true` that this machine has no value for yet.
export const missingSecrets = (extensions: DiscoveredExtension[]): SecretKey[] => {
  const stored = readSecrets();
  return extensions.flatMap((ext) => {
    const id = ext.id ?? '';
    return ext.secrets.filter((key) => stored[id]?.[key] === undefined).map((key) => ({ id, key }));
  });
};
