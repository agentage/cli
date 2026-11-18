import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliGate, fits } from './installer/compat.js';
import { kitVersion } from './kit-version.js';

const kitDir = dirname(createRequire(import.meta.url).resolve('@agentage/extension/package.json'));

// The desktop and the deployed app host show one shell: the daemon serves the bundled kit's.
describe('the bundled kit', () => {
  it('is 0.18.9, and a kit-shaped ^0.18.9 range fits the cli', () => {
    expect(kitVersion()).toBe('0.18.9');
    expect(fits({ engine: '^0.18.9', kit: true }, cliGate())).toBe(true);
  });

  it('ships the shell whose nav foot holds the Inbox bell', () => {
    const shell = readFileSync(join(kitDir, 'dist/shell/dist/shell.js'), 'utf8');
    const foot = shell.indexOf('className:"foot"');
    expect(foot).toBeGreaterThan(-1);
    expect(shell.indexOf('className:"ib inboxbtn"', foot)).toBeGreaterThan(foot);
  });
});
