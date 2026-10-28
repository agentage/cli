import { describe, expect, it } from 'vitest';
import { type MachineFile } from './machine.js';
import { effective, mergeConfig } from './merge.js';
import { type Profile } from './schema.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const DEV = '@agentage/fixture-dev';

const machine: MachineFile = {
  id: 'm_8f2a91c0',
  name: 'box',
  dev: { [DEV]: '/home/me/dev' },
  profileSource: 'file',
};

const profile: Profile = {
  version: 1,
  plugins: { [WORLD]: '^1.0.0', [HELLO]: '^1.0.0' },
  config: { hello: { greeting: 'hi', tags: ['a', 'b'], keep: true } },
  machines: {
    m_8f2a91c0: {
      off: [WORLD],
      config: { hello: { greeting: 'yo', tags: ['c'] }, world: { x: 1 } },
      extra: {},
    },
    m_other: { off: [HELLO], config: {}, extra: {} },
  },
  extra: {},
};

describe('effective (T04)', () => {
  it('installs the shared map, loads it minus off plus dev', () => {
    const eff = effective(profile, machine);
    expect(eff.install).toEqual({ [WORLD]: '^1.0.0', [HELLO]: '^1.0.0' });
    expect(eff.load).toEqual([DEV, HELLO]);
    expect(eff.off).toEqual([WORLD]);
    expect(eff.dev).toEqual(machine.dev);
  });

  it('replaces shared config per key, arrays whole, no deep merge', () => {
    const { config } = effective(profile, machine);
    expect(config['hello']).toEqual({ greeting: 'yo', tags: ['c'], keep: true });
    expect(config['world']).toEqual({ x: 1 });
  });

  it('ignores other machines entries', () => {
    const eff = effective(profile, { ...machine, id: 'm_unknown', dev: {} });
    expect(eff.load).toEqual([HELLO, WORLD]);
    expect(eff.config['hello']?.['greeting']).toBe('hi');
  });

  it('with no profile, only dev plugins load', () => {
    const eff = effective(null, machine);
    expect(eff).toEqual({ install: {}, load: [DEV], off: [], dev: machine.dev, config: {} });
  });

  it('merges config maps by plugin id', () => {
    expect(mergeConfig({ a: { k: 1 } }, { b: { k: 2 } })).toEqual({ a: { k: 1 }, b: { k: 2 } });
  });
});
