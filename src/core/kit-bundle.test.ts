import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliGate, fits } from './installer/compat.js';
import { kitVersion } from './kit-version.js';

const KIT = '@agentage/extension/package.json';
const kitDir = dirname(createRequire(import.meta.url).resolve(KIT));
const apphostJson = createRequire(import.meta.url).resolve('@agentage/apphost/package.json');

// The desktop and the deployed app host show one shell: the shell package that apphost serves.
describe('the bundled kit', () => {
  it('is 0.20.3, and a kit-shaped ^0.20.0 range fits the cli', () => {
    expect(kitVersion()).toBe('0.20.3');
    expect(fits({ engine: '^0.20.0', kit: true }, cliGate())).toBe(true);
  });

  // One kit in the tree: the daemon (apphost) runs the children on the kit the cli bundles.
  it('is the kit that @agentage/apphost resolves', () => {
    const fromApphost = dirname(createRequire(apphostJson).resolve(KIT));
    expect(realpathSync(fromApphost)).toBe(realpathSync(kitDir));
  });

  it('serves the shell package whose nav foot holds the Inbox bell', () => {
    const shellJs = createRequire(apphostJson).resolve('@agentage/shell-dashboard/dist/shell.js');
    const shell = readFileSync(shellJs, 'utf8');
    const foot = shell.indexOf('className:"foot"');
    expect(foot).toBeGreaterThan(-1);
    expect(shell.indexOf('className:"ib inboxbtn"', foot)).toBeGreaterThan(foot);
  });
});
