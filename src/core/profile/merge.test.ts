import { describe, expect, it } from 'vitest';
import { MACHINE_ID, pkg } from '../../test/config-dir.js';
import { type MachineFile } from './machine.js';
import { effective, keepMachine } from './merge.js';
import { type Profile } from './schema.js';

const [HELLO, WORLD, DEV] = [pkg('hello'), pkg('world'), pkg('dev')];

const machine: MachineFile = {
  id: MACHINE_ID,
  name: 'box',
  dev: { [DEV]: '/home/me/dev' },
  profileSource: 'file',
  accountId: null,
  profileEtag: null,
};

const profile: Profile = {
  version: 1,
  extensions: { [WORLD]: '^1.0.0', [HELLO]: '^1.0.0' },
  registries: {},
  config: { hello: { greeting: 'hi', tags: ['a', 'b'], keep: true } },
  machines: {
    [MACHINE_ID]: {
      off: [WORLD],
      config: { hello: { greeting: 'yo', tags: ['c'] }, world: { x: 1 } },
      extra: {},
    },
    m_other: { off: [HELLO], config: {}, extra: {} },
  },
  extra: {},
};

describe('what this machine installs and loads', () => {
  it("installs the profile's extensions; loads them minus its own off list, plus its dev paths", () => {
    expect(effective(profile, machine)).toMatchObject({
      install: { [WORLD]: '^1.0.0', [HELLO]: '^1.0.0' },
      load: [DEV, HELLO],
      off: [WORLD],
      dev: machine.dev,
    });
  });

  it('takes its own config per key over the shared one, arrays whole, no deep merge', () => {
    expect(effective(profile, machine).config).toEqual({
      hello: { greeting: 'yo', tags: ['c'], keep: true },
      world: { x: 1 },
    });
  });

  it("ignores other machines' entries", () => {
    const other = effective(profile, { ...machine, id: 'm_unknown', dev: {} });
    expect(other).toMatchObject({ load: [HELLO, WORLD], off: [] });
    expect(other.config['hello']?.['greeting']).toBe('hi');
  });

  it('with no profile, loads only its dev paths', () => {
    const none = effective(null, machine);
    expect(none).toEqual({ install: {}, load: [DEV], off: [], dev: machine.dev, config: {} });
  });
});

describe('saving a new profile over a local one', () => {
  const next: Profile = {
    ...profile,
    extensions: { [HELLO]: '^2' },
    machines: { [MACHINE_ID]: { off: [], config: {}, extra: {} } },
  };

  it("replaces the shared fields and keeps this machine's own entry from the local copy", () => {
    const kept = keepMachine(next, profile, MACHINE_ID);
    expect(kept.extensions).toEqual({ [HELLO]: '^2' });
    expect(kept.machines).toEqual({ [MACHINE_ID]: profile.machines[MACHINE_ID] });
  });

  it('takes the new profile as is when the local copy has no entry for this machine', () => {
    expect(keepMachine(next, null, MACHINE_ID)).toBe(next);
    expect(keepMachine(next, profile, 'm_nothere')).toBe(next);
  });
});
