// The account's machines at /v1/machines: registered by the CLI, listed and forgotten by the dashboard.
import { isRecord, json, type Reply } from './http.js';
import { failure } from './profile.js';
import { storeProfile } from './profile.js';
import { type StubAccount, type StubMachine } from './state.js';

const MACHINE_ID = /^m_[0-9a-f]{8}$/;
const STATES: readonly unknown[] = ['connected', 'disconnected'];

const now = (): string => new Date().toISOString();

const notFound = (id: string): Reply => failure(404, 'MACHINE_NOT_FOUND', `no machine ${id}`);

const record = (status: number, machine: StubMachine): Reply =>
  json(status, { success: true, data: machine });

const upsertProblem = (body: unknown): Reply | null => {
  const ok = isRecord(body) && typeof body['platform'] === 'string';
  if (!ok || typeof body['cliVersion'] !== 'string' || !STATES.includes(body['state']))
    return failure(400, 'VALIDATION_ERROR', 'platform, cliVersion and state are required');
  if (body['managed'] === true)
    return failure(403, 'MANAGED_REQUIRES_INFRASTRUCTURE', 'managed is set by infrastructure only');
  return null;
};

// A new record takes the name sent (else the id); a known one keeps its name and managed flag.
const upsert = (account: StubAccount, id: string, body: unknown): Reply => {
  const refused = upsertProblem(body);
  if (refused || !isRecord(body)) return refused ?? failure(400, 'VALIDATION_ERROR', 'no body');
  const old = account.machines.get(id);
  const at = now();
  const machine: StubMachine = {
    id,
    name: old?.name ?? (typeof body['name'] === 'string' ? body['name'] : id),
    platform: String(body['platform']),
    cliVersion: String(body['cliVersion']),
    managed: old?.managed ?? false,
    state: body['state'] as StubMachine['state'],
    firstSeenAt: old?.firstSeenAt ?? at,
    lastSeenAt: at,
  };
  account.machines.set(id, machine);
  return record(old ? 200 : 201, machine);
};

const seen = (account: StubAccount, id: string, cliVersion?: string): Reply => {
  const machine = account.machines.get(id);
  if (!machine) return notFound(id);
  account.machines.set(id, {
    ...machine,
    lastSeenAt: now(),
    ...(cliVersion ? { cliVersion } : {}),
  });
  return { status: 204 };
};

const patch = (account: StubAccount, id: string, body: unknown): Reply => {
  const machine = account.machines.get(id);
  if (!machine) return notFound(id);
  if (!isRecord(body) || (body['state'] !== undefined && !STATES.includes(body['state'])))
    return failure(400, 'VALIDATION_ERROR', 'send name or state');
  const { name, state } = body as Partial<StubMachine>;
  const next = { ...machine, ...(name ? { name } : {}), ...(state ? { state } : {}) };
  account.machines.set(id, next);
  return record(200, next);
};

// Forget: the record goes, and so does profile.machines[id], under a new ETag.
const forget = (account: StubAccount, id: string): Reply => {
  const known = account.machines.delete(id);
  const stored = account.profile;
  const machines = isRecord(stored?.profile['machines']) ? stored.profile['machines'] : {};
  if (stored && id in machines) {
    const rest = Object.fromEntries(Object.entries(machines).filter(([key]) => key !== id));
    storeProfile(account, { ...stored, profile: { ...stored.profile, machines: rest } });
  }
  return known || (stored && id in machines) ? { status: 204 } : notFound(id);
};

const list = (account: StubAccount): Reply => {
  const data = [...account.machines.values()].sort((a, b) =>
    a.lastSeenAt < b.lastSeenAt ? 1 : -1
  );
  return json(200, {
    success: true,
    data,
    meta: { pagination: { limit: 50, total: data.length } },
  });
};

// `/v1/machines`, `/v1/machines/<id>` and `/v1/machines/<id>/seen`.
export const machinesRoute = (
  account: StubAccount,
  method: string,
  path: string,
  body: unknown,
  cliVersion?: string
): Reply => {
  const [id, action] = path.split('/').slice(3);
  if (id === undefined) return method === 'GET' ? list(account) : notFound('');
  if (!MACHINE_ID.test(id))
    return failure(400, 'INVALID_MACHINE_ID', 'id must match ^m_[0-9a-f]{8}$');
  if (action === 'seen' && method === 'POST') return seen(account, id, cliVersion);
  if (action !== undefined) return notFound(id);
  if (method === 'PUT') return upsert(account, id, body);
  if (method === 'PATCH') return patch(account, id, body);
  return method === 'DELETE' ? forget(account, id) : notFound(id);
};
