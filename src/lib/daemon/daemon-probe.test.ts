import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { serve, type Served } from '../../test/serve.js';
import { probe, probeRetry, proven } from './daemon-probe.js';

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const HEALTH = {
  status: 'ok',
  service: 'agentage-daemon',
  pid: 42,
  version: '0.52.0',
  protocol: 1,
  extensions: [],
};
const FILE = { pid: 42, port: 1, version: '0.52.0', protocol: 1, startedBy: 'cli' };

describe('what answers on the daemon port', () => {
  it('our daemon, another program, nothing', async () => {
    served = await serve(() => [200, HEALTH]);
    const found = await probe(served.port);
    expect(found).toEqual({ kind: 'ours', health: HEALTH });
    expect(proven(FILE, found)).toEqual(HEALTH);
    expect(proven({ ...FILE, pid: 7 }, found)).toBeNull();
    await served.close();
    served = await serve(() => [200, { status: 'ok', version: '1.0.0', extensions: [] }]);
    expect(await probe(served.port)).toEqual({ kind: 'foreign' });
    const { port } = served;
    await served.close();
    served = undefined;
    expect(await probe(port)).toEqual({ kind: 'none' });
  });

  it('a port that accepts and never answers is silent, after each retry', async () => {
    const hang = createServer(() => undefined);
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve));
    const { port } = hang.address() as { port: number };
    expect(await probeRetry(port, 2, 100)).toEqual({ kind: 'silent' });
    hang.closeAllConnections();
    await new Promise((resolve) => hang.close(resolve));
  });
});
