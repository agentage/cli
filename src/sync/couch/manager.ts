import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CouchSync,
  CouchTokenClient,
  createCouchState,
  isAccountVault,
  type CouchState,
  type CouchStatePersistence,
  type FetchLike,
  type FetchJson,
  type FileStore,
  type VaultsConfig,
} from '@agentage/memory-core';
import { currentBearer } from '../../lib/api.js';
import { getConfigDir, readAuth } from '../../lib/config.js';
import { links, siteFqdn } from '../../lib/origins.js';
import { defaultProvisionDeps, provisionAccountVault } from '../../lib/provision.js';
import { loadVaultsConfig } from '../../lib/vaults.js';
import { type MemoryVerb } from '../../daemon/actions.js';
import { createSyncGit, GitError } from '../git-exec.js';
import { intervalMs } from '../planner.js';
import { createDiscovery, type ChannelDecision, type Discovery } from './discovery.js';
import { createFileStore } from './file-store.js';
import { createStatePersistence } from './state-store.js';
import { autoCouchTargets, couchTargets, type CouchTarget } from './targets.js';

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
interface CouchLike {
  pushFileLive(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  syncNow(): Promise<void>;
}

type MakeCouchSync = (
  files: FileStore,
  cfg: { endpoint: string; db: string },
  fetch: FetchLike,
  authorize: () => Promise<string>,
  onUnauthorized: () => void,
  state: CouchState,
  log?: (msg: string) => void
) => CouchLike;

interface CommitOutcome {
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

interface TargetState {
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

// Map one memory-verb wire payload to the account vault + vault-relative POSIX path it mutated, or
// null when the target is not an account vault (git/local mutations never touch the couch channel).
export const resolveMutationTarget = (
  config: VaultsConfig,
  body: unknown
): { vault: string; path: string } | null => {
  const p = (body ?? {}) as { ref?: unknown; opts?: { vault?: unknown } };
  const ref = typeof p.ref === 'string' ? p.ref : '';
  if (!ref) return null;
  let vault: string | undefined;
  let path: string;
  if (ref.startsWith('@')) {
    const m = ref.match(/^@([^/]+)\/(.+)$/);
    if (!m) return null; // a bare '@vault' is not a file mutation
    vault = m[1];
    path = m[2] as string;
  } else {
    vault = (typeof p.opts?.vault === 'string' ? p.opts.vault : undefined) ?? config.default;
    if (!vault) {
      const names = Object.keys(config.vaults ?? {});
      if (names.length === 1) vault = names[0];
    }
    path = ref;
  }
  if (!vault) return null;
  const entry = config.vaults?.[vault];
  if (!entry || !isAccountVault(entry)) return null;
  return { vault, path: path.replace(/^\.?\//, '') };
};

// The default local-git commit: stage everything and make one commit when the tree is dirty. An
// index.lock collision (the engine mid-mutation) is a clean skip - the change stays for next cycle.
const gitCommitDirty = async (path: string, message: string): Promise<CommitOutcome> => {
  if (!existsSync(path)) return { committed: false, skipped: false };
  const git = createSyncGit(path);
  try {
    if (!existsSync(join(path, '.git'))) await git.run(['init', '-b', 'main']);
    await git.run(['add', '-A']);
    if ((await git.exec(['diff', '--cached', '--quiet'])).code === 0)
      return { committed: false, skipped: false };
    await git.run(['commit', '-m', message]);
    return { committed: true, skipped: false };
  } catch (err) {
    if (err instanceof GitError && err.kind === 'lock') return { committed: false, skipped: true };
    throw err;
  }
};

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init as RequestInit);

const defaultFetchJson: FetchJson = async (url, token) => {
  const res = await globalThis.fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

// The daemon-side couch scheduler: per-account-vault timers + a persistent CouchSync per target for
// sync-on-save. Every couch failure is caught and recorded (lastError / paused); it never crashes
// the daemon and never blocks a memory API response.
export const createCouchSyncManager = (deps: CouchSyncManagerDeps = {}): CouchSyncManager => {
  const getConfig = deps.getConfig ?? (() => loadVaultsConfig().config);
  const configDir = deps.configDir ?? getConfigDir;
  const getBearer = deps.getBearer ?? (() => currentBearer(readAuth, links(siteFqdn())));
  const fetch = deps.fetch ?? defaultFetch;
  const makeFileStore = deps.makeFileStore ?? createFileStore;
  const makeStatePersistence = deps.makeStatePersistence ?? createStatePersistence;
  const makeCouchSync: MakeCouchSync =
    deps.makeCouchSync ??
    ((files, cfg, f, authorize, onUnauthorized, state, log) =>
      new CouchSync(files, cfg, f, authorize, onUnauthorized, state, log));
  const commitDirty = deps.commitDirty ?? gitCommitDirty;
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const discovery =
    deps.discovery ??
    createDiscovery({
      bootstrapHost: links(siteFqdn()).sync,
      fetchJson: defaultFetchJson,
      provision: (vault) => provisionAccountVault(vault, defaultProvisionDeps()),
    });

  const states = new Map<string, TargetState>();
  const timers = new Map<string, NodeJS.Timeout>();

  const ensureTargetState = (target: CouchTarget): TargetState => {
    const existing = states.get(target.vault);
    if (existing) {
      existing.target = target;
      return existing;
    }
    const fresh: TargetState = { target, files: makeFileStore(target.path), running: false };
    states.set(target.vault, fresh);
    return fresh;
  };

  const getState = (st: TargetState): Promise<CouchState> =>
    (st.statePromise ??= createCouchState(makeStatePersistence(configDir(), st.target.vault)).then(
      (s) => (st.state = s)
    ));

  const ensureWire = async (st: TargetState, d: ChannelDecision): Promise<CouchLike> => {
    if (d.kind !== 'couch') throw new Error('ensureWire: not a couch channel');
    const key = `${d.endpoint}|${d.db}|${d.tokenUrl}`;
    if (st.couch && st.wireKey === key) return st.couch;
    const state = await getState(st);
    const tokens = new CouchTokenClient(d.tokenUrl, st.target.vault, fetch, getBearer, Date.now);
    st.couch = makeCouchSync(
      st.files,
      { endpoint: d.endpoint, db: d.db },
      fetch,
      () => tokens.token(),
      () => tokens.invalidate(),
      state,
      log
    );
    st.wireKey = key;
    return st.couch;
  };

  const cycle = async (st: TargetState): Promise<CouchSyncResult> => {
    const vault = st.target.vault;
    const build = (extra: Partial<CouchSyncResult>): CouchSyncResult => ({
      vault,
      channel: 'couch',
      ok: true,
      committed: false,
      pulled: false,
      pendingCount: st.state?.pendingPaths().length ?? 0,
      ...extra,
    });
    if (st.running) return build({});
    st.running = true;
    try {
      const bearer = await getBearer();
      if (!bearer) {
        st.paused = 'signed out';
        st.lastError = undefined;
        return build({ paused: 'signed out' });
      }
      const decision = await discovery.channelFor(vault, bearer);
      if (decision.kind === 'paused') {
        st.paused = decision.reason;
        st.lastError = undefined;
        return build({ paused: decision.reason });
      }
      st.paused = undefined;
      const couch = await ensureWire(st, decision);
      const pre = await commitDirty(st.target.path, `sync: ${nowIso()}`);
      await couch.syncNow(); // pushAll (rev-cache skips no-ops) then pullOnce
      const post = await commitDirty(st.target.path, `sync: couch ${nowIso()}`);
      st.lastSync = nowIso();
      st.lastError = undefined;
      return build({ committed: pre.committed, pulled: post.committed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      st.lastError = msg;
      return build({ ok: false, error: msg });
    } finally {
      st.running = false;
    }
  };

  // Sync-on-save: push (or tombstone) one path right after the engine committed it. Failures queue
  // the path in the module's pending set (retried by the next cycle) and never surface to the API.
  const pushOnWrite = async (st: TargetState, verb: MemoryVerb, path: string): Promise<void> => {
    try {
      const bearer = await getBearer();
      if (bearer) {
        const decision = await discovery.channelFor(st.target.vault, bearer);
        if (decision.kind === 'couch') {
          const couch = await ensureWire(st, decision);
          if (verb === 'delete') await couch.removeFile(path);
          else await couch.pushFileLive(path);
          return;
        }
      }
      if (verb !== 'delete') await (await getState(st)).enqueue(path); // deferred until a wire exists
    } catch (err) {
      log(`couch push-on-write ${path}: ${err instanceof Error ? err.message : String(err)}`);
      if (verb !== 'delete')
        await getState(st)
          .then((s) => s.enqueue(path))
          .catch(() => {});
    }
  };

  return {
    reschedule() {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
      const targets = couchTargets(getConfig());
      const live = new Set(targets.map((t) => t.vault));
      for (const vault of [...states.keys()]) if (!live.has(vault)) states.delete(vault);
      for (const t of targets) void getState(ensureTargetState(t)).catch(() => {});
      for (const t of autoCouchTargets(getConfig())) {
        const timer = setInterval(
          () => void cycle(ensureTargetState(t)),
          intervalMs(t.intervalSeconds)
        );
        timer.unref?.();
        timers.set(t.vault, timer);
      }
    },
    async runNow(vault) {
      const t = couchTargets(getConfig()).find((x) => x.vault === vault);
      if (!t) throw new Error(`'${vault}' is not an account vault`);
      return cycle(ensureTargetState(t));
    },
    onWrite(verb, body) {
      if (verb !== 'write' && verb !== 'edit' && verb !== 'delete') return;
      const target = resolveMutationTarget(getConfig(), body);
      if (!target) return;
      const t = couchTargets(getConfig()).find((x) => x.vault === target.vault);
      if (!t) return;
      void pushOnWrite(ensureTargetState(t), verb, target.path);
    },
    status() {
      return couchTargets(getConfig()).map((t): CouchTargetStatus => {
        const st = states.get(t.vault);
        return {
          vault: t.vault,
          channel: 'couch',
          intervalSeconds: t.intervalSeconds,
          lastSync: st?.lastSync,
          lastError: st?.lastError,
          pendingCount: st?.state?.pendingPaths().length ?? 0,
          paused: st?.paused,
          running: st?.running ?? false,
        };
      });
    },
    stop() {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    },
  };
};
