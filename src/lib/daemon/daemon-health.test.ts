import { describe, expect, it } from 'vitest';
import { degradedReasons, healthLines, sealOffLine, withSealError } from './daemon-health.js';
import { type Health, type Probe } from './daemon-probe.js';

const SEAL = 'seal off: Node 22.22.2 or 24.14.1 needed, this is Node 24.6.0';
const probeEntry = { id: 'probe', version: '0.7.0', state: 'running' };

const health = (over: Partial<Health> & Record<string, unknown> = {}): Health => ({
  status: 'ok',
  service: 'agentage-daemon',
  pid: 7,
  version: '0.53.0',
  protocol: 1,
  extensions: [{ ...probeEntry, parts: ['api', 'mcp', 'worker'], seal: 'on', restarts: 2 }],
  ...over,
});

describe('daemon status of kit 0.15 (C1): parts, seal, restarts', () => {
  it('each entry line names its parts, seal and restarts; an older daemon prints the plain line', () => {
    expect(healthLines(health(), [])).toEqual([
      '  probe 0.7.0 running; parts api, mcp, worker; seal on; restarts 2',
    ]);
    expect(healthLines(health({ extensions: [probeEntry] }), [])).toEqual([
      '  probe 0.7.0 running',
    ]);
    const starting = { ...probeEntry, state: 'starting', parts: [], seal: 'on' as const };
    expect(healthLines(health({ extensions: [starting] }), [])).toEqual([
      '  probe 0.7.0 starting; seal on',
    ]);
  });

  it('seal off is a degraded reason with the daemon words; each entry carries them in --json', () => {
    const off = health({
      status: 'degraded',
      seal: 'off',
      sealError: SEAL,
      extensions: [{ ...probeEntry, parts: [], seal: 'off', restarts: 0 }],
    });
    expect(degradedReasons(off)).toEqual([SEAL]);
    expect(healthLines(off, degradedReasons(off)).at(-1)).toBe(`  degraded: ${SEAL}`);
    expect(withSealError(off).extensions[0]).toMatchObject({ seal: 'off', sealError: SEAL });
  });

  it('install prints the seal-off reason only when the daemon says so', async () => {
    const off: Probe = { kind: 'ours', health: health({ seal: 'off', sealError: SEAL }) };
    expect(await sealOffLine(1, async () => off)).toBe(SEAL);
    expect(await sealOffLine(1, async () => ({ kind: 'ours', health: health() }))).toBeNull();
    expect(await sealOffLine(1, async () => ({ kind: 'none' }))).toBeNull();
  });
});
