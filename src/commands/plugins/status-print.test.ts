import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pluginStatusLines } from './status-print.js';
import { type PluginRow, type PluginsStatus } from './status-rows.js';

const row = (extra: Partial<PluginRow>): PluginRow => ({
  id: 'hello',
  package: '@agentage/fixture-hello',
  mode: 'installed',
  wanted: '^1',
  installed: '1.0.0',
  state: 'installed',
  error: null,
  commands: [],
  lastRun: null,
  ...extra,
});

const status = (extra: Partial<PluginsStatus>): PluginsStatus => ({
  machine: { id: 'm_0000beef', name: 'box' },
  profile: { state: 'ok', version: 1, source: 'default', readOnly: false },
  plugins: [],
  ...extra,
});

describe('pluginStatusLines', () => {
  let level: typeof chalk.level;

  beforeEach(() => {
    level = chalk.level;
    chalk.level = 0;
  });

  afterEach(() => {
    chalk.level = level;
  });

  it('prints machine, profile and plugin count lines', () => {
    expect(pluginStatusLines(status({}))).toEqual([
      'machine    m_0000beef (box)',
      'profile    version 1 (source: default)',
      'plugins    none',
    ]);
  });

  it('prints the profile states', () => {
    const missing = pluginStatusLines(status({ profile: { state: 'missing' } }));
    expect(missing[1]).toBe('profile    no profile');
    const invalid = pluginStatusLines(status({ profile: { state: 'invalid', errors: ['x'] } }));
    expect(invalid[1]).toBe('profile    profile.json is invalid');
    const readOnly = { state: 'ok' as const, version: 2, source: 'file' as const, readOnly: true };
    expect(pluginStatusLines(status({ profile: readOnly }))[1]).toBe(
      'profile    version 2 (source: file, read-only)'
    );
  });

  const rows = [
    row({ commands: ['hello'], lastRun: { at: 'T', state: 'ok', error: null } }),
    row({ id: 'oldengine', package: '@agentage/fixture-old-engine', state: 'invalid', error: 'x' }),
    row({ id: null, mode: 'dev', installed: null, state: 'missing' }),
    row({ wanted: null, lastRun: { at: 'T', state: 'failed', error: 'boom' } }),
  ];

  it('prints one aligned row per plugin with commands, last run and reason', () => {
    expect(pluginStatusLines(status({ plugins: rows })).slice(2)).toEqual([
      'plugins    4',
      '  hello      installed  @agentage/fixture-hello 1.0.0 (wants ^1)  commands: hello  last run: ok at T',
      '  oldengine  invalid    @agentage/fixture-old-engine 1.0.0 (wants ^1)  x',
      '  ?          missing    @agentage/fixture-hello - (dev)',
      '  hello      installed  @agentage/fixture-hello 1.0.0 (wants ?)  last run: failed "boom" at T',
    ]);
  });
});
