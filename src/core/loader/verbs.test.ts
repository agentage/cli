import { describe, expect, it } from 'vitest';
import { test } from '../../test/config-dir.js';
import { type DiscoveredExtension } from './discover.js';
import { claimVerbs, commandNames, readHeld, writeHeld } from './verbs.js';

const ext = (id: string, commands: string[], kind: 'api' | 'kit' = 'kit'): DiscoveredExtension => ({
  pkg: `@test/${id}`,
  kind,
  source: 'dev',
  dir: `/dev/${id}`,
  version: '1.0.0',
  id,
  entry: `/dev/${id}/cli.js`,
  commands,
  kitCommands: commands.map((name) => ({ name, summary: name })),
  peers: [],
  optionalPeers: [],
  config: {},
  secrets: [],
  descriptions: {},
  problem: null,
  missing: false,
});

const [PROBE, PONG, HELLO] = [
  ext('probe', ['ping']),
  ext('pong', ['ping']),
  ext('hello', ['hello'], 'api'),
];
const none = new Map<string, string>();

describe('who runs agentage <command> for a kit-built extension', () => {
  it('gives each command its top-level verb when nothing else has the name', () => {
    const verbs = claimVerbs([PROBE, HELLO], none);
    expect([...verbs.top]).toEqual([['ping', '@test/probe']]);
    expect(verbs.namespaced).toEqual([]);
    expect(commandNames(PROBE, verbs)).toEqual(['ping']);
  });

  it('keeps a core command, an extension id and a 1.0 command for their owners', () => {
    const kit = ext('kit', ['status', 'pong', 'hello', 'help']);
    const verbs = claimVerbs([kit, PONG, HELLO], none);
    expect(verbs.top.get('status')).toBeUndefined();
    expect(verbs.namespaced.map(({ name, why }) => `${name} ${why}`)).toEqual([
      'status is a core command',
      'pong is taken by extension pong',
      'hello is taken by extension hello',
      'help is a core command',
    ]);
    expect(commandNames(kit, verbs)).toEqual(['kit status', 'kit pong', 'kit hello', 'kit help']);
  });

  it('a later claimant keeps only the namespaced form; the earlier holder keeps the verb', () => {
    const fresh = claimVerbs([PROBE, PONG], none);
    expect(fresh.top.get('ping')).toBe('@test/probe');
    expect(fresh.namespaced).toEqual([
      { pkg: '@test/pong', id: 'pong', name: 'ping', why: 'is taken by extension probe' },
    ]);
    const held = claimVerbs([PROBE, PONG], new Map([['ping', '@test/pong']]));
    expect(held.top.get('ping')).toBe('@test/pong');
    expect(held.namespaced.map((n) => n.id)).toEqual(['probe']);
  });

  it('forgets a holder that is gone or no longer declares the verb', () => {
    const held = new Map([
      ['ping', '@test/gone'],
      ['pang', '@test/probe'],
    ]);
    expect([...claimVerbs([PONG, PROBE], held).top]).toEqual([['ping', '@test/pong']]);
  });

  it('1.0 extensions never get verbs: their commands are their own already', () => {
    const greet = ext('hello', ['hello', 'hello:greet'], 'api');
    const verbs = claimVerbs([greet], none);
    expect(verbs).toEqual({ top: new Map(), namespaced: [] });
    expect(commandNames(greet, verbs)).toEqual(['hello', 'hello:greet']);
  });
});

describe('commands.json: who held each verb after the last install', () => {
  test('is absent until there is a holder, then round-trips; unchanged is not rewritten', ({
    dir,
  }) => {
    expect(readHeld().size).toBe(0);
    writeHeld(new Map());
    expect(dir.exists('commands.json')).toBe(false);
    writeHeld(new Map([['ping', '@test/probe']]));
    expect(dir.json('commands.json')).toEqual({ ping: '@test/probe' });
    expect([...readHeld()]).toEqual([['ping', '@test/probe']]);
  });

  test('a file of another shape reads as nobody', ({ dir }) => {
    dir.write('commands.json', { ping: 1 });
    expect(readHeld().size).toBe(0);
  });
});
