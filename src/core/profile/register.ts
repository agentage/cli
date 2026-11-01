import { VERSION } from '../../utils/version.js';
import { errorCode, type CloudFetch } from './cloud.js';
import { type MachineFile } from './machine.js';

// Fire and forget: never longer than this, never a failure, silent unless AGENTAGE_DEBUG=1.
const BUDGET_MS = 2_000;
const NAME_MAX = 128;

interface Call {
  method: 'PUT' | 'POST' | 'PATCH';
  path: string;
  body?: object;
}

const routeOf = (id: string): string => `/v1/machines/${id}`;

const debug = (text: string): void => {
  if (process.env['AGENTAGE_DEBUG'] === '1') console.error(`machines: ${text}`);
};

interface Answer {
  status: number;
  // A 404's envelope code: MACHINE_NOT_FOUND from the route, anything else without it.
  code: string | null;
}

// A 404's body is read for its code; any other body is dropped unread.
const answerOf = async (res: Response): Promise<Answer> => {
  if (res.status === 404) return { status: 404, code: await errorCode(res) };
  await res.body?.cancel();
  return { status: res.status, code: null };
};

// What the account answered, or null when it did not.
const send = async (
  fetch: CloudFetch,
  call: Call,
  timeoutMs = BUDGET_MS
): Promise<Answer | null> => {
  const headers: Record<string, string> = call.body ? { 'content-type': 'application/json' } : {};
  const body = call.body ? JSON.stringify(call.body) : undefined;
  try {
    const answer = await answerOf(
      await fetch(call.path, { method: call.method, headers, body, timeoutMs })
    );
    debug(`${call.method} ${call.path} ${answer.status}${answer.code ? ` ${answer.code}` : ''}`);
    return answer;
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
    debug(`${call.method} ${call.path} failed: ${reason}`);
    return null;
  }
};

const registration = (machine: Pick<MachineFile, 'name'>) => ({
  name: machine.name.slice(0, NAME_MAX),
  platform: `${process.platform}-${process.arch}`,
  cliVersion: VERSION,
  state: 'connected',
});

// Signed-in setup: create or refresh the record, then mark it seen, both inside one budget.
export const registerMachine = async (
  fetch: CloudFetch,
  machine: Pick<MachineFile, 'id' | 'name'>
): Promise<void> => {
  const deadline = Date.now() + BUDGET_MS;
  const path = routeOf(machine.id);
  await send(fetch, { method: 'PUT', path, body: registration(machine) });
  await send(fetch, { method: 'POST', path: `${path}/seen` }, Math.max(1, deadline - Date.now()));
};

// true when the account knows this machine, false on MACHINE_NOT_FOUND, null when it did not
// say: any other 404 is an API without the route, as unknown as no answer.
export const seenMachine = async (fetch: CloudFetch, id: string): Promise<boolean | null> => {
  const answer = await send(fetch, { method: 'POST', path: `${routeOf(id)}/seen` });
  if (answer?.code === 'MACHINE_NOT_FOUND') return false;
  return answer !== null && answer.status >= 200 && answer.status < 300 ? true : null;
};

export const disconnectMachine = async (fetch: CloudFetch, id: string): Promise<void> => {
  await send(fetch, { method: 'PATCH', path: routeOf(id), body: { state: 'disconnected' } });
};
