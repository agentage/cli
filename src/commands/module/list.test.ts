import chalk from 'chalk';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerModule, rowLines, runModuleList, summaryLines } from './list.js';
import { type ModuleRow, type ModulesGather, type ModulesStatus } from './rows.js';

const row = (extra: Partial<ModuleRow>): ModuleRow => ({
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

const status = (extra: Partial<ModulesStatus>): ModulesStatus => ({
  machine: { id: 'm_0000beef', name: 'box' },
  profile: { state: 'ok', version: 1, source: 'default', readOnly: false },
  modules: [],
  ...extra,
});

describe('module list lines', () => {
  let level: typeof chalk.level;

  beforeEach(() => {
    level = chalk.level;
    chalk.level = 0;
  });

  afterEach(() => {
    chalk.level = level;
  });

  it('summarizes machine, profile and the module count for status', () => {
    expect(summaryLines(status({ modules: [row({})] }))).toEqual([
      'machine    m_0000beef (box)',
      'profile    version 1 (source: default)',
      'modules    1',
    ]);
    const readOnly = { state: 'ok' as const, version: 2, source: 'file' as const, readOnly: true };
    expect(summaryLines(status({ profile: readOnly }))[1]).toBe(
      'profile    version 2 (source: file, read-only)'
    );
    expect(summaryLines(status({ profile: { state: 'missing' } }))[1]).toBe(
      'profile    no profile'
    );
    const invalid = status({ profile: { state: 'invalid', errors: ['x'] } });
    expect(summaryLines(invalid)[1]).toBe('profile    invalid');
  });

  it('prints one aligned row per module with commands, last run and reason', () => {
    expect(
      rowLines([
        row({ commands: ['hello'], lastRun: { at: 'T', state: 'ok', error: null } }),
        row({
          id: 'oldengine',
          package: '@agentage/fixture-old-engine',
          state: 'invalid',
          error: 'x',
        }),
        row({ id: null, mode: 'dev', installed: null, state: 'missing' }),
        row({ wanted: null, lastRun: { at: 'T', state: 'failed', error: 'boom' } }),
      ])
    ).toEqual([
      'hello      installed  @agentage/fixture-hello 1.0.0 (wants ^1)  commands: hello  last run: ok at T',
      'oldengine  invalid    @agentage/fixture-old-engine 1.0.0 (wants ^1)  x',
      '?          missing    @agentage/fixture-hello - (dev)',
      'hello      installed  @agentage/fixture-hello 1.0.0 (wants ?)  last run: failed "boom" at T',
    ]);
  });
});

describe('runModuleList', () => {
  const capture = async (gathered: ModulesGather, json = false) => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const error = await runModuleList({ json }, () => Promise.resolve(gathered)).then(
        () => null,
        (e: unknown) => e
      );
      const text = (spy: typeof out) => spy.mock.calls.map((call) => String(call[0])).join('\n');
      return { stdout: text(out), stderr: text(err), error };
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  };

  it('says "no modules" for an empty set and prints warnings on stderr', async () => {
    const result = await capture({ status: status({}), warnings: ['w'] });
    expect(result).toEqual({ stdout: 'no modules', stderr: 'warning: w', error: null });
  });

  it('--json prints machine, profile and the rows; an invalid profile then fails', async () => {
    const invalid = status({ profile: { state: 'invalid', errors: ['bad'] } });
    const result = await capture({ status: invalid, warnings: [] }, true);
    expect(JSON.parse(result.stdout)).toEqual(invalid);
    expect(String(result.error)).toContain('profile.json is invalid:\n  bad');
  });
});

describe('registerModule', () => {
  const parse = async (...args: string[]) => {
    let out = '';
    let err = '';
    const list = vi.fn(async () => undefined);
    const program = new Command()
      .exitOverride()
      .configureOutput({ writeOut: (s) => void (out += s), writeErr: (s) => void (err += s) });
    registerModule(program, list);
    const code = await program.parseAsync(['node', 'agentage', 'module', ...args]).then(
      () => 0,
      (e: { exitCode: number }) => e.exitCode
    );
    return { code, out, err, list };
  };

  it('prints the group help for a bare `module` and exits 0', async () => {
    const result = await parse();
    expect(result.code).toBe(0);
    expect(result.out).toContain('Usage: agentage module');
    expect(result.out).toContain('list [options]');
  });

  it('runs `module list --json` and refuses an unknown subcommand', async () => {
    const listed = await parse('list', '--json');
    expect(listed.list).toHaveBeenCalledWith({ json: true }, expect.anything());
    const unknown = await parse('nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.err).toContain("error: unknown command 'nope'");
  });
});
