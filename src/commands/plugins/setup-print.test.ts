import { describe, expect, it } from 'vitest';
import { type InstallPlan } from '../../core/installer/installer.js';
import { installLine, planLines } from './setup-print.js';

const plan = (extra: Partial<InstallPlan>): InstallPlan => ({
  pluginsDir: '/cfg/plugins',
  registry: 'http://127.0.0.1:4873',
  install: { '@agentage/fixture-hello': '^1.0.0', '@agentage/fixture-world': '^1' },
  manifest: '{}',
  lock: null,
  npm: 'install',
  tree: null,
  reuse: false,
  ...extra,
});

describe('planLines', () => {
  it('prints source, registry, dir, the set and what npm would do', () => {
    expect(planLines('two.json', plan({}))).toEqual([
      'dry run    nothing written',
      'profile    two.json',
      'registry   http://127.0.0.1:4873',
      'plugins    /cfg/plugins',
      'install    2 plugins',
      '  @agentage/fixture-hello  ^1.0.0',
      '  @agentage/fixture-world  ^1',
      'npm        install --ignore-scripts (no lock yet)',
      'tree       named from the lock npm writes',
    ]);
  });

  it('names the npm command and the tree for each lock state', () => {
    const npmLine = (p: InstallPlan): string | undefined =>
      planLines('p', p).find((l) => l.startsWith('npm'));
    expect(npmLine(plan({ lock: '{}' }))).toBe(
      'npm        install --ignore-scripts (the lock does not match package.json)'
    );
    expect(npmLine(plan({ npm: 'ci', lock: '{}', tree: 'abc' }))).toBe(
      'npm        ci --ignore-scripts (the lock matches package.json)'
    );
    const reused = planLines('p', plan({ npm: null, tree: 'abc', reuse: true }));
    expect(reused.slice(-2)).toEqual([
      'npm        skipped, tree already installed',
      'tree       abc',
    ]);
    const empty = planLines('p', plan({ install: {}, npm: null, tree: 'e3b0' }));
    expect(empty).toContain('install    no plugins');
    expect(empty).toContain('npm        skipped');
  });
});

describe('installLine', () => {
  it('says how many plugins landed in which tree and how', () => {
    const base = { tree: 'abc', count: 2, reused: false };
    expect(installLine({ ...base, npm: 'install' })).toBe(
      'install    2 plugins in tree abc (npm install)'
    );
    expect(installLine({ ...base, npm: null, reused: true, count: 1 })).toBe(
      'install    1 plugin in tree abc (reused)'
    );
    expect(installLine({ ...base, npm: null, count: 0 })).toBe(
      'install    no plugins in tree abc (npm skipped)'
    );
  });
});
