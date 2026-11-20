import { cpSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { check } from '@agentage/extension/tool';
import { describe, expect, it } from 'vitest';
import { fixture, test, type ConfigDir } from '../test/config-dir.js';
import { cliGate, fits } from './installer/compat.js';
import { kitVersion } from './kit-version.js';

const KIT = '@agentage/extension/package.json';
const kitDir = dirname(createRequire(import.meta.url).resolve(KIT));
const apphostJson = createRequire(import.meta.url).resolve('@agentage/apphost/package.json');

// The desktop and the deployed app host show one shell: the shell package that apphost serves.
describe('the bundled kit', () => {
  it('is 0.21.0, and a kit-shaped ^0.21.0 range fits the cli', () => {
    expect(kitVersion()).toBe('0.21.0');
    expect(fits({ engine: '^0.21.0', kit: true }, cliGate())).toBe(true);
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

// `extension check` runs this kit: an extension on engines.agentage ^0.21 passes its stack rule.
describe('the stack rule of the bundled kit', () => {
  const stackOf = async (dir: ConfigDir, engine: string): Promise<string[]> => {
    cpSync(fixture('probe'), dir.at('probe'), { recursive: true });
    const pkg = dir.json('probe/package.json');
    const dependencies = { '@agentage/extension': `${engine}.0` };
    dir.write('probe/package.json', { ...pkg, engines: { agentage: engine }, dependencies });
    const report = await check(dir.at('probe'));
    expect(report.rules).toContain('stack');
    return report.problems.filter((p) => p.rule === 'stack').map((p) => p.problem);
  };

  test('passes engines.agentage ^0.21 with kit ^0.21.0', async ({ dir }) => {
    expect(await stackOf(dir, '^0.21')).toEqual([]);
  });

  test('refuses engines.agentage ^0.22, the next kit minor', async ({ dir }) => {
    expect(await stackOf(dir, '^0.22')).toContain('kit 0.21.0 is outside engines.agentage ^0.22');
  });
});
