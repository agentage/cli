import { createCouchState, CouchTokenClient, type CouchState } from '@agentage/memory-core';
import { type ChannelDecision } from './discovery.js';
import { type CouchLike, type CouchRuntime, type TargetState } from './manager.types.js';

// Everything queued for retry: failed/deferred pushes plus not-yet-tombstoned deletions.
export const pendingCount = (st: TargetState | undefined): number =>
  st?.state ? st.state.pendingPaths().length + st.state.deletionPaths().length : 0;

export const getState = (rt: CouchRuntime, st: TargetState): Promise<CouchState> =>
  (st.statePromise ??= createCouchState(
    rt.makeStatePersistence(rt.configDir(), st.target.vault)
  ).then((s) => (st.state = s)));

export const ensureWire = async (
  rt: CouchRuntime,
  st: TargetState,
  d: ChannelDecision
): Promise<CouchLike> => {
  if (d.kind !== 'couch') throw new Error('ensureWire: not a couch channel');
  const key = `${d.endpoint}|${d.db}|${d.tokenUrl}`;
  if (st.couch && st.wireKey === key) return st.couch;
  const state = await getState(rt, st);
  const tokens = new CouchTokenClient(
    d.tokenUrl,
    st.target.vault,
    rt.fetch,
    rt.getBearer,
    Date.now
  );
  st.couch = rt.makeCouchSync(
    st.files,
    { endpoint: d.endpoint, db: d.db },
    rt.fetch,
    () => tokens.token(),
    () => tokens.invalidate(),
    state,
    rt.log
  );
  st.wireKey = key;
  return st.couch;
};
