import {
  type CouchState,
  type CouchStatePersistence,
  type FetchLike,
  type FileStore,
  type SyncResult as CouchChannelResult,
  type VaultsConfig,
} from '@agentage/memory-core';
import { type MemoryVerb } from '../../daemon/actions.js';
import { type Discovery } from './discovery.js';
import { type CouchTarget } from './targets.js';

export interface CouchSyncResult {
  vault: string;
  channel: 'couch';
  ok: boolean;
  committed: boolean; // committed local dirty changes before the push
  pulled: boolean; // a pull applied changes and they were committed
  pendingCount: number;
  paused?: string; // set when the target is paused (signed out / not provisioned)
  error?: string;
}

export interface CouchTargetStatus {
  vault: string;
  channel: 'couch';
  intervalSeconds: number;
  lastSync?: string;
  lastError?: string;
  pendingCount: number;
  paused?: string;
  running: boolean;
}

// What the manager uses from a CouchSync - the real class satisfies it; tests inject a mock.
export interface CouchLike {
  pushFileLive(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  flushPending(): Promise<void>;
  syncNow(): Promise<CouchChannelResult>;
}

export type MakeCouchSync = (
  files: FileStore,
  cfg: { endpoint: string; db: string },
  fetch: FetchLike,
  authorize: () => Promise<string>,
  onUnauthorized: () => void,
  state: CouchState,
  log?: (msg: string) => void
) => CouchLike;

export interface CommitOutcome {
  committed: boolean;
  skipped: boolean; // an index.lock collision - retried next cycle
}

export interface CouchSyncManagerDeps {
  getConfig?: () => VaultsConfig;
  configDir?: () => string;
  getBearer?: () => Promise<string | null>;
  discovery?: Discovery;
  fetch?: FetchLike;
  makeFileStore?: (path: string) => FileStore;
  makeStatePersistence?: (configDir: string, vault: string) => CouchStatePersistence;
  makeCouchSync?: MakeCouchSync;
  commitDirty?: (path: string, message: string) => Promise<CommitOutcome>;
  now?: () => string; // ISO timestamp
  log?: (msg: string) => void;
}

export interface CouchSyncManager {
  reschedule(): void;
  runNow(vault: string): Promise<CouchSyncResult>;
  onWrite(verb: MemoryVerb, body: unknown): void;
  status(): CouchTargetStatus[];
  stop(): void;
}

export interface TargetState {
  target: CouchTarget;
  files: FileStore;
  state?: CouchState;
  statePromise?: Promise<CouchState>;
  couch?: CouchLike;
  wireKey?: string;
  running: boolean;
  lastSync?: string;
  lastError?: string;
  paused?: string;
}

// Resolved deps shared by the extracted wire/cycle/push-on-write seams; built once by the manager.
export interface CouchRuntime {
  configDir: () => string;
  getBearer: () => Promise<string | null>;
  fetch: FetchLike;
  makeCouchSync: MakeCouchSync;
  makeStatePersistence: (configDir: string, vault: string) => CouchStatePersistence;
  commitDirty: (path: string, message: string) => Promise<CommitOutcome>;
  discovery: Discovery;
  nowIso: () => string;
  log: (msg: string) => void;
}
