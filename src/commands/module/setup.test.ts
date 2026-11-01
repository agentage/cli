import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type InstallPlan, type InstallResult } from '../../core/installer/installer.js';
import { parseProfile, type Profile, type ProfileParse } from '../../core/profile/schema.js';
import { installLine, planLines, runModuleSetup, type ModuleSetupDeps } from './setup.js';
import { type ModuleRow } from './rows.js';

// The happy paths (install, dry run, refusals, plain setup) are e2e scenarios in e2e/core.
const HELLO = '@agentage/fixture-hello';
const TWO = { version: 1, modules: { [HELLO]: '^1.0.0', '@agentage/fixture-world': '^1' } };
const RESULT: InstallResult = { tree: 'abc', npm: 'install', reused: false, count: 2 };
const SELF = 'm_0000beef';
const ROW = 'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)';
const HELLO_ROW: ModuleRow = {
  id: 'hello',
  package: HELLO,
  mode: 'installed',
  wanted: '^1.0.0',
  installed: '1.0.0',
  state: 'installed',
  error: null,
  commands: [],
  lastRun: null,
};

const makeDeps = (files: Record<string, string> = {}, local: ProfileParse | null = null) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  let saved: Profile | null = null;
  const deps: ModuleSetupDeps = {
    ensureSignedIn: vi.fn(async () => {
      calls.push('sign-in');
      return 'already' as const;
    }),
    signOut: vi.fn(async () => void calls.push('sign-out')),
    printStatus: vi.fn(async () => void calls.push('status')),
    readFile: (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    readLocal: () => local,
    loadMachine: async () => ({ id: SELF, name: 'box', dev: {}, profileSource: 'default' }),
    saveProfile: vi.fn(async (fn: (current: Profile | null) => Profile) => {
      saved = fn(local?.ok ? local.profile : null);
      calls.push('save');
      return saved;
    }),
    setSource: async (source: string) => void calls.push(`source:${source}`),
    plan: vi.fn((set: Record<string, string>) => ({ install: set }) as unknown as InstallPlan),
    install: vi.fn(async () => {
      calls.push('install');
      return RESULT;
    }),
    gather: async () => ({
      status: {
        machine: { id: SELF, name: 'box' },
        profile: { state: 'missing' as const },
        modules: [HELLO_ROW],
      },
      warnings: ['modules tree "x" is incomplete and was ignored'],
    }),
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  };
  return { deps, out, err, calls, saved: () => saved };
};

describe('runModuleSetup', () => {
  let level: typeof chalk.level;

  beforeEach(() => {
    level = chalk.level;
    chalk.level = 0;
  });

  afterEach(() => {
    chalk.level = level;
  });

  it('--profile keeps this machine entry from the local profile and records the source', async () => {
    const local = parseProfile({ version: 1, modules: {}, machines: { [SELF]: { off: [HELLO] } } });
    const h = makeDeps({ 'two.json': JSON.stringify(TWO) }, local);
    await runModuleSetup({ profile: 'two.json' }, h.deps);
    expect(h.calls).toEqual(['save', 'source:file', 'install']);
    expect(h.saved()?.modules).toEqual(TWO.modules);
    expect(h.saved()?.machines[SELF]?.off).toEqual([HELLO]);
    expect(h.out).toEqual(['install    2 modules in tree abc (npm install)', ROW]);
    expect(h.err).toEqual(['warning: modules tree "x" is incomplete and was ignored']);
  });

  it('a failed install still prints the rows, then fails the step', async () => {
    const h = makeDeps({ 'two.json': JSON.stringify(TWO) });
    vi.mocked(h.deps.install).mockRejectedValue(new Error('npm install failed'));
    await expect(runModuleSetup({ profile: 'two.json' }, h.deps)).rejects.toThrow(
      'npm install failed'
    );
    expect(h.out).toEqual([ROW]);
  });

  it('reports unreadable, unparsable and URL profiles', async () => {
    const h = makeDeps({ 'junk.json': '{ nope' });
    const run = (profile: string) => runModuleSetup({ profile }, h.deps);
    await expect(run('gone.json')).rejects.toThrow('cannot read profile gone.json: ENOENT');
    await expect(run('junk.json')).rejects.toThrow('junk.json is invalid:\n  not valid JSON');
    await expect(run('https://x/p.json')).rejects.toThrow('profile URLs are not supported');
    expect(h.calls).toEqual([]);
  });

  it('a --dry-run prints the warnings of a read-only profile and plans it', async () => {
    const h = makeDeps({ 'v2.json': JSON.stringify({ ...TWO, version: 2, extra: true }) });
    await runModuleSetup({ profile: 'v2.json', dryRun: true }, h.deps);
    expect(h.err).toEqual([
      'warning: profile.json: unknown key "extra" kept',
      expect.stringContaining('version: 2 is newer'),
    ]);
    expect(h.deps.plan).toHaveBeenCalledWith(TWO.modules);
    expect(h.calls).toEqual([]);
  });

  it('--disconnect signs out and skips the profile flow', async () => {
    const h = makeDeps();
    await runModuleSetup({ disconnect: true, profile: 'two.json' }, h.deps);
    expect(h.calls).toEqual(['sign-out']);
  });

  it('plain setup passes the sign-in flags, and prints status even when the profile fails', async () => {
    const h = makeDeps({}, { ok: false, errors: ['version: must be 1 (got 0)'] });
    await expect(runModuleSetup({ reauth: true, browser: false }, h.deps)).rejects.toThrow(
      'profile.json is invalid:\n  version: must be 1 (got 0)'
    );
    expect(h.deps.ensureSignedIn).toHaveBeenCalledWith({ reauth: true, browser: false });
    expect(h.calls).toEqual(['sign-in', 'status']);
  });

  it('plain --dry-run plans from the local profile without signing in', async () => {
    const h = makeDeps({}, parseProfile(TWO));
    await runModuleSetup({ dryRun: true }, h.deps);
    expect(h.calls).toEqual([]);
    expect(h.deps.plan).toHaveBeenCalledWith(TWO.modules);
  });
});

const plan = (extra: Partial<InstallPlan>): InstallPlan => ({
  modulesDir: '/cfg/modules',
  registry: 'http://127.0.0.1:4873',
  install: { [HELLO]: '^1.0.0' },
  manifest: '{}',
  lock: null,
  npm: 'install',
  tree: null,
  reuse: false,
  ...extra,
});

describe('setup lines', () => {
  const npmLine = (p: InstallPlan): string | undefined =>
    planLines('p', p).find((l) => l.startsWith('npm'));

  it('names the npm command for each lock state, and the tree once it is known', () => {
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
    expect(empty).toEqual(expect.arrayContaining(['install    no modules', 'npm        skipped']));
  });

  it('says how many modules landed in which tree and how', () => {
    const base = { tree: 'abc', count: 2, reused: false };
    expect(installLine({ ...base, npm: 'install' })).toBe(
      'install    2 modules in tree abc (npm install)'
    );
    expect(installLine({ ...base, npm: null, reused: true, count: 1 })).toBe(
      'install    1 module in tree abc (reused)'
    );
    expect(installLine({ ...base, npm: null, count: 0 })).toBe(
      'install    no modules in tree abc (npm skipped)'
    );
  });
});
