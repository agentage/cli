import { describe, expect } from 'vitest';
import { MACHINE_ID, pkg, test } from '../../test/config-dir.js';
import { addExtension, changeProfile, dropExtension } from './edit.js';
import { defaultProfile } from './profile.js';
import { type Profile } from './schema.js';

const [HELLO, WORLD] = [pkg('hello'), pkg('world')];

const withMachines = (machines: Record<string, string[]>): Profile => ({
  ...defaultProfile(),
  extensions: { [HELLO]: '^1.0.0', [WORLD]: '^1' },
  machines: Object.fromEntries(
    Object.entries(machines).map(([id, off]) => [
      id,
      { off, config: { hello: { x: 1 } }, extra: {} },
    ])
  ),
});

describe('extension install and remove, as a change to the profile', () => {
  test("adding sets the spec; with --off it is listed once in this machine's off list", () => {
    const added = addExtension(defaultProfile(), HELLO, '^1.0.0', MACHINE_ID, true);
    expect(added.extensions).toEqual({ [HELLO]: '^1.0.0' });
    expect(addExtension(added, HELLO, '~1.0.0', MACHINE_ID, true)).toMatchObject({
      extensions: { [HELLO]: '~1.0.0' },
      machines: { [MACHINE_ID]: { off: [HELLO], config: {}, extra: {} } },
    });
  });

  test('adding without --off turns it back on here, and adds no machine entry where none was', () => {
    const back = addExtension(
      withMachines({ [MACHINE_ID]: [HELLO, WORLD] }),
      HELLO,
      '^1',
      MACHINE_ID,
      false
    );
    expect(back.machines[MACHINE_ID]).toEqual({
      off: [WORLD],
      config: { hello: { x: 1 } },
      extra: {},
    });
    expect(addExtension(defaultProfile(), HELLO, '^1', MACHINE_ID, false).machines).toEqual({});
  });

  test("removing drops it from extensions and this machine's off list; other machines keep theirs", () => {
    const dropped = dropExtension(
      withMachines({ [MACHINE_ID]: [HELLO], m_other: [HELLO] }),
      HELLO,
      MACHINE_ID
    );
    expect(dropped.extensions).toEqual({ [WORLD]: '^1' });
    expect(dropped.machines[MACHINE_ID]?.off).toEqual([]);
    expect(dropped.machines['m_other']?.off).toEqual([HELLO]);
  });

  test('a change saves profile.json, keeps a file source as file and makes any other source default', async ({
    dir,
  }) => {
    dir.machine();
    dir.write('machine.json', { ...dir.json('machine.json'), profileSource: 'file' });
    await changeProfile((p) => addExtension(p, HELLO, '^1.0.0', MACHINE_ID, false));
    expect(dir.json('machine.json')['profileSource']).toBe('file');
    expect(dir.json('profile.json')['extensions']).toEqual({ [HELLO]: '^1.0.0' });
    dir.write('machine.json', { ...dir.json('machine.json'), profileSource: 'cloud' });
    await changeProfile((p) => dropExtension(p, HELLO, MACHINE_ID));
    expect(dir.json('machine.json')['profileSource']).toBe('default');
  });

  test('a change never overwrites an invalid profile.json', async ({ dir }) => {
    dir.write('profile.json', '{ nope');
    await expect(changeProfile((p) => p)).rejects.toThrow(
      'profile.json is invalid:\n  not valid JSON'
    );
    expect(dir.file('profile.json')).toBe('{ nope');
  });
});
