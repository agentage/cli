import { AuthRequiredError, introspectToken } from '../auth/api.js';
import { type AuthState } from '../fs/config.js';
import { health, syncStatus } from '../daemon/daemon-client.js';
import { fetchJsonUnref } from '../net/http.js';
import { environment, links, type Env } from '../net/origins.js';
import { checkForUpdate, type UpdateInfo } from '../update/update-check.js';
import { VERSION } from '../../utils/version.js';
import { isDaemonRunning, resolvePort } from '../../daemon/lifecycle.js';
import { type SyncStatus } from '../../sync/git/manager.js';

export interface DaemonSyncSummary {
  vaults: number;
  state: 'ok' | 'error' | 'syncing';
  lastRun?: string;
  lastError?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port: number;
  uptimeSeconds?: number;
  mcp?: boolean;
  // The running daemon's own version, so the printer can flag a stale binary inline.
  daemonVersion?: string;
  sync?: DaemonSyncSummary;
}

export interface StatusReport {
  version: string;
  fqdn: string;
  env: Env;
  auth: { signedIn: boolean; tokenExpiresAt?: string; note?: string };
  endpoint: { url: string; reachable: boolean };
  update: UpdateInfo;
  daemon?: DaemonStatus;
}

// node:https via fetchJsonUnref, not global fetch: undici's ref'd connect timer keeps the process
// alive ~10s after an aborted request on a packet-drop network, stalling `status` exit.
const checkEndpoint = async (apiUrl: string): Promise<boolean> => {
  const res = await fetchJsonUnref(`${apiUrl}/health`, 3000);
  return res?.ok ?? false;
};

// Fold the git + couch per-vault states into one summary: any error wins, then any in-flight
// run, else ok. lastRun is the freshest reported; lastError the first seen.
const summarizeSync = (sync: SyncStatus): DaemonSyncSummary => {
  const git = sync.vaults;
  const couch = sync.couch ?? [];
  const vaults = git.length + couch.length;
  const error =
    git.find((v) => v.lastError)?.lastError ?? couch.find((v) => v.lastError)?.lastError;
  const running = git.some((v) => v.running) || couch.some((v) => v.running);
  const state: DaemonSyncSummary['state'] = error ? 'error' : running ? 'syncing' : 'ok';
  const runs = [...git.map((v) => v.lastRun), ...couch.map((v) => v.lastSync)].filter(
    (r): r is string => Boolean(r)
  );
  const lastRun = runs.sort().at(-1);
  return { vaults, state, lastRun, lastError: error };
};

// Probe the local daemon only when its pidfile says it is running, so a stopped daemon costs no
// network and never hangs `status`. All fields ride the existing /health + /sync wire.
const probeDaemon = async (): Promise<DaemonStatus> => {
  const port = resolvePort();
  if (!isDaemonRunning()) return { running: false, port };
  const h = await health(port);
  if (!h) return { running: false, port };
  const sync = await syncStatus(port);
  const summary = sync ? summarizeSync(sync) : undefined;
  return {
    running: true,
    pid: h.pid,
    port,
    uptimeSeconds: h.uptime,
    mcp: h.mcp !== false,
    daemonVersion: h.version,
    sync: summary && summary.vaults > 0 ? summary : undefined,
  };
};

export const gatherStatus = async (auth: AuthState | null, fqdn: string): Promise<StatusReport> => {
  const target = links(fqdn);
  // Endpoint reachability and the (npm-registry) update check are independent - run them
  // together so `status` stays snappy.
  const [reachable, update, daemon] = await Promise.all([
    checkEndpoint(target.api),
    checkForUpdate(VERSION),
    probeDaemon(),
  ]);
  const report: StatusReport = {
    version: VERSION,
    fqdn,
    env: environment(fqdn),
    auth: { signedIn: false, note: 'not signed in - run: agentage setup' },
    endpoint: { url: target.api, reachable },
    update,
    daemon,
  };
  if (!auth) return report;
  try {
    const session = await introspectToken(auth, target);
    report.auth = { signedIn: true, tokenExpiresAt: session.expiresAt };
  } catch (err) {
    report.auth =
      err instanceof AuthRequiredError
        ? { signedIn: false, note: 'session expired - run: agentage setup' }
        : {
            signedIn: false,
            note: `could not verify session: ${err instanceof Error ? err.message : String(err)}`,
          };
  }
  return report;
};
