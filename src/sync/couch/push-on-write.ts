import { type MemoryVerb } from '../../daemon/actions.js';
import { type CouchRuntime, type TargetState } from './manager.types.js';
import { ensureWire, getState } from './wire.js';

// Sync-on-save: push (or tombstone) one path right after the engine committed it. Failures queue
// the path in the module's persisted pending/deletion sets (retried by the next cycle) and never
// surface to the API. A delete is durable regardless of auth/network state at delete time: with
// no wire it enqueues the deletion, and removeFile itself self-enqueues on transport failure.
export const pushOnWrite = async (
  rt: CouchRuntime,
  st: TargetState,
  verb: MemoryVerb,
  path: string
): Promise<void> => {
  const defer = async (): Promise<void> => {
    const state = await getState(rt, st);
    if (verb === 'delete') await state.enqueueDeletion(path);
    else await state.enqueue(path);
  };
  try {
    const bearer = await rt.getBearer();
    if (bearer) {
      const decision = await rt.discovery.channelFor(st.target.vault, bearer);
      if (decision.kind === 'couch') {
        const couch = await ensureWire(rt, st, decision);
        if (verb === 'delete') await couch.removeFile(path);
        else await couch.pushFileLive(path);
        return;
      }
    }
    await defer(); // no wire yet (signed out / paused) - queued until one exists
  } catch (err) {
    rt.log(`couch push-on-write ${path}: ${err instanceof Error ? err.message : String(err)}`);
    await defer().catch(() => {});
  }
};
