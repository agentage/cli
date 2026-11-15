import { type IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { kitInternal } from '../../test/kit-internal.js';
import { refusedBy } from './up-guard.js';

// The installed kit's guard, not a copy: the cli's fallback must refuse exactly what it refuses.
// A kit that allows [::1] fails this table: that bump deletes up-guard.ts and uses the kit's.
type Handler = (req: unknown, res: unknown, next: () => void) => void;
type LocalOnly = (port: () => number) => Handler;

const kitRefuses = async (headers: Record<string, string>, port: number): Promise<boolean> => {
  const guard = 'dist/host/daemon/guard.js';
  const { localOnly } = await kitInternal<{ localOnly: LocalOnly }>(guard, 'up-guard.ts');
  const req = { get: (name: string) => headers[name.toLowerCase()], socket: { localPort: port } };
  try {
    let passed = false;
    localOnly(() => port)(req, {}, () => void (passed = true));
    return !passed;
  } catch {
    return true;
  }
};

const P = 4244;
const CASES: [string, Record<string, string>, boolean][] = [
  ['127.0.0.1 with no Origin', { host: `127.0.0.1:${P}` }, false],
  [
    'localhost with its own Origin',
    { host: `localhost:${P}`, origin: `http://localhost:${P}` },
    false,
  ],
  ['[::1]: the server binds 127.0.0.1 only', { host: `[::1]:${P}` }, true],
  ['another Host (DNS rebinding)', { host: `evil.test:${P}` }, true],
  ['another port', { host: `127.0.0.1:${P + 1}` }, true],
  ['an empty Origin', { host: `127.0.0.1:${P}`, origin: '' }, true],
  ['a foreign Origin', { host: `127.0.0.1:${P}`, origin: 'http://evil.test' }, true],
  ['a cross-site request', { host: `127.0.0.1:${P}`, 'sec-fetch-site': 'cross-site' }, true],
  ['a same-site request', { host: `127.0.0.1:${P}`, 'sec-fetch-site': 'same-site' }, true],
  ['a same-origin request', { host: `127.0.0.1:${P}`, 'sec-fetch-site': 'same-origin' }, false],
];

describe("the cli's local-only guard for extension up", () => {
  it.each(CASES)(
    '%s: the cli and the kit guard decide the same',
    async (_name, headers, refused) => {
      const req = { headers } as unknown as IncomingMessage;
      expect(refusedBy(req, P) !== null).toBe(refused);
      expect(await kitRefuses(headers, P)).toBe(refused);
    }
  );
});
