import { CouchSync, type FetchLike, type FetchJson } from '@agentage/memory-core';
import { currentBearer } from '../../lib/api.js';
import { getConfigDir, readAuth } from '../../lib/config.js';
import { links, siteFqdn } from '../../lib/origins.js';
import { defaultProvisionDeps, provisionAccountVault } from '../../lib/provision.js';
import { loadVaultsConfig } from '../../lib/vaults.js';
import { intervalMs } from '../git/planner.js';
import { runCouchCycle } from './cycle.js';
import { createDiscovery } from './discovery.js';
import { createFileStore } from './file-store.js';
import { gitCommitDirty } from './local-commit.js';
import {
  type CouchRuntime,
  type CouchSyncManager,
  type CouchSyncManagerDeps,
  type CouchTargetStatus,
  type MakeCouchSync,
  type TargetState,
} from './manager.types.js';
import { resolveMutationTarget } from './mutation-target.js';
import { pushOnWrite } from './push-on-write.js';
import { createStatePersistence } from './state-store.js';
import { autoCouchTargets, couchTargets, type CouchTarget } from './targets.js';
import { getState, pendingCount } from './wire.js';

export {
  type CouchSyncManager,
  type CouchSyncManagerDeps,
  type CouchSyncResult,
  type CouchTargetStatus,
} from './manager.types.js';
export { resolveMutationTarget } from './mutation-target.js';

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
  const getBearer = deps.getBearer ?? (() => currentBearer(readAuth, links(siteFqdn())));
  const makeFileStore = deps.makeFileStore ?? createFileStore;
  const makeCouchSync: MakeCouchSync =
    deps.makeCouchSync ??
    ((files, cfg, f, authorize, onUnauthorized, state, log) =>
      new CouchSync(files, cfg, f, authorize, onUnauthorized, state, log));
  const rt: CouchRuntime = {
    configDir: deps.configDir ?? getConfigDir,
    getBearer,
    fetch: deps.fetch ?? defaultFetch,
    makeCouchSync,
    makeStatePersistence: deps.makeStatePersistence ?? createStatePersistence,
    commitDirty: deps.commitDirty ?? gitCommitDirty,
    discovery:
      deps.discovery ??
      createDiscovery({
        bootstrapHost: links(siteFqdn()).sync,
        fetchJson: defaultFetchJson,
        provision: (vault) => provisionAccountVault(vault, defaultProvisionDeps()),
      }),
    nowIso: deps.now ?? (() => new Date().toISOString()),
    log: deps.log ?? (() => {}),
  };

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

  return {
    reschedule() {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
      const targets = couchTargets(getConfig());
      const live = new Set(targets.map((t) => t.vault));
      for (const vault of [...states.keys()]) if (!live.has(vault)) states.delete(vault);
      for (const t of targets) void getState(rt, ensureTargetState(t)).catch(() => {});
      for (const t of autoCouchTargets(getConfig())) {
        const timer = setInterval(
          () => void runCouchCycle(rt, ensureTargetState(t)),
          intervalMs(t.intervalSeconds)
        );
        timer.unref?.();
        timers.set(t.vault, timer);
      }
    },
    async runNow(vault) {
      const t = couchTargets(getConfig()).find((x) => x.vault === vault);
      if (!t) throw new Error(`'${vault}' is not an account vault`);
      return runCouchCycle(rt, ensureTargetState(t));
    },
    onWrite(verb, body) {
      if (verb !== 'write' && verb !== 'edit' && verb !== 'delete') return;
      const target = resolveMutationTarget(getConfig(), body);
      if (!target) return;
      const t = couchTargets(getConfig()).find((x) => x.vault === target.vault);
      if (!t) return;
      void pushOnWrite(rt, ensureTargetState(t), verb, target.path);
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
          pendingCount: pendingCount(st),
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
