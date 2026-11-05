import { describe, expect, it } from 'vitest';
import { cliEntryOf, isKitShaped, kitCommandsOf, kitShapeProblem } from './kit-manifest.js';

const PING = { name: 'ping', summary: 'answer pong' };

describe('a kit-shaped agentage block, read as data', () => {
  it('is kit-shaped exactly when agentage.parts is there', () => {
    expect(isKitShaped({ parts: { cli: true } })).toBe(true);
    expect(isKitShaped({ parts: 'x' })).toBe(true);
    expect(isKitShaped({ contributes: { commands: ['x'] } })).toBe(false);
  });

  it.each([
    [{ cli: true }, './dist/cli/index.js'],
    [{ cli: {} }, './dist/cli/index.js'],
    [{ cli: { entry: './cli.js' } }, './cli.js'],
    [{ cli: false }, null],
    [{ api: true }, null],
    ['nope', null],
  ])('parts %j has the command entry %j', (parts, entry) => {
    expect(cliEntryOf(parts)).toBe(entry);
  });

  it('reads each command with its summary; anything that is not an object is left out', () => {
    expect(kitCommandsOf([PING, { name: 'x' }, 'y'])).toEqual([PING, { name: 'x', summary: '' }]);
    expect(kitCommandsOf(undefined)).toEqual([]);
  });

  it('is fine with parts and declared commands, or parts alone', () => {
    expect(kitShapeProblem({ parts: { cli: true }, commands: [PING] })).toBeNull();
    expect(kitShapeProblem({ parts: { api: true } })).toBeNull();
  });

  it.each([
    [{ parts: [] }, 'agentage.parts must be an object'],
    [{ parts: {}, commands: {} }, 'agentage.commands must be a list'],
    [
      { parts: { cli: true }, commands: ['ping'] },
      'agentage.commands: null must match [a-z0-9][a-z0-9-]*',
    ],
    [
      { parts: { cli: true }, commands: [{ name: 'Ping', summary: '' }] },
      'agentage.commands: "Ping" must match [a-z0-9][a-z0-9-]*',
    ],
    [
      { parts: { cli: true }, commands: [PING, PING] },
      'agentage.commands: "ping" is declared twice',
    ],
    [
      { parts: { cli: true }, commands: [{ name: 'ping' }] },
      'agentage.commands: "ping" has no summary',
    ],
    [{ parts: { api: true }, commands: [PING] }, 'agentage.commands needs parts.cli'],
  ])('is wrong with %j: %s', (agentage, problem) => {
    expect(kitShapeProblem(agentage)).toBe(problem);
  });
});
