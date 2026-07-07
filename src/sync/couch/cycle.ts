import { type CouchRuntime, type CouchSyncResult, type TargetState } from './manager.types.js';
import { ensureWire, pendingCount } from './wire.js';

// One couch cycle: commit dirty local truth first, drain queued pushes/deletions, then push+pull.
// Every failure is caught and recorded (lastError / paused); it never throws to the caller.
export const runCouchCycle = async (
  rt: CouchRuntime,
  st: TargetState
): Promise<CouchSyncResult> => {
  const vault = st.target.vault;
  const build = (extra: Partial<CouchSyncResult>): CouchSyncResult => ({
    vault,
    channel: 'couch',
    ok: true,
    committed: false,
    pulled: false,
    pendingCount: pendingCount(st),
    ...extra,
  });
  if (st.running) return build({});
  st.running = true;
  try {
    const bearer = await rt.getBearer();
    if (!bearer) {
      st.paused = 'signed out';
      st.lastError = undefined;
      return build({ paused: 'signed out' });
    }
    const decision = await rt.discovery.channelFor(vault, bearer);
    if (decision.kind === 'paused') {
      st.paused = decision.reason;
      st.lastError = undefined;
      return build({ paused: decision.reason });
    }
    st.paused = undefined;
    const couch = await ensureWire(rt, st, decision);
    const pre = await rt.commitDirty(st.target.path, `sync: ${rt.nowIso()}`);
    await couch.flushPending(); // drain queued pushes AND queued deletions first
    const res = await couch.syncNow(); // pushAll + reconcile deletions, then pullOnce
    const post = await rt.commitDirty(st.target.path, `sync: couch ${rt.nowIso()}`);
    if (res.error) {
      st.lastError = res.error;
      return build({
        ok: false,
        committed: pre.committed,
        pulled: post.committed,
        error: res.error,
      });
    }
    st.lastSync = rt.nowIso();
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
