import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type InstallPlan, type InstallResult } from '../../core/installer/installer.js';
import { defaultProfile } from '../../core/profile/default-profile.js';
import { parseProfile, type Profile, type ProfileParse } from '../../core/profile/schema.js';
import { pluginsSetupDeps, runPluginsSetup, type PluginsSetupDeps } from './setup.js';

const HELLO = '@agentage/fixture-hello';
const TWO = { version: 1, plugins: { [HELLO]: '^1.0.0', '@agentage/fixture-world': '^1' } };
const RESULT: InstallResult = { tree: 'abc', npm: 'install', reused: false, count: 2 };
const SELF = 'm_0000beef';

const parsed = (doc: unknown): ProfileParse => parseProfile(doc);

const makeDeps = (files: Record<string, string> = {}, local: ProfileParse | null = null) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  let saved: Profile | null = null;
  const deps: PluginsSetupDeps = {
    ensureSignedIn: vi.fn(async () => {
      calls.push('sign-in');
      return 'already' as const;
    }),
    signOut: vi.fn(async () => void calls.push('sign-out')),
    printStatus: vi.fn(async () => void calls.push('status')),
    readFile: vi.fn((path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    }),
    readLocal: vi.fn(() => local),
    loadMachine: vi.fn(async () => ({
      id: SELF,
      name: 'box',
      dev: {},
      profileSource: 'default' as const,
    })),
    saveProfile: vi.fn(async (fn: (current: Profile | null) => Profile) => {
      saved = fn(local?.ok ? local.profile : null);
      calls.push('save');
      return saved;
    }),
    setSource: vi.fn(async (source: string) => void calls.push(`source:${source}`)),
    scopes: () => ['@agentage'],
    plan: vi.fn((set: Record<string, string>) => ({ install: set }) as unknown as InstallPlan),
    install: vi.fn(async () => {
      calls.push('install');
      return RESULT;
    }),
    gather: vi.fn(async () => ({
      status: {
        machine: { id: SELF, name: 'box' },
        profile: { state: 'ok' as const, version: 1, source: 'file' as const, readOnly: false },
        plugins: [],
      },
      warnings: ['plugins tree "x" is incomplete and was ignored'],
    })),
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  };
  return { deps, out, err, calls, saved: () => saved };
};

describe('runPluginsSetup', () => {
  let level: typeof chalk.level;

  beforeEach(() => {
    level = chalk.level;
    chalk.level = 0;
  });

  afterEach(() => {
    chalk.level = level;
  });

  it('--profile never signs in: saves, records the file source, installs, summarizes', async () => {
    const h = makeDeps({ 'two.json': JSON.stringify(TWO) });
    await runPluginsSetup({ profile: 'two.json' }, h.deps);
    expect(h.calls).toEqual(['save', 'source:file', 'install']);
    expect(h.deps.ensureSignedIn).not.toHaveBeenCalled();
    expect(h.deps.install).toHaveBeenCalledWith(TWO.plugins);
    expect(h.out[0]).toBe('install    2 plugins in tree abc (npm install)');
    expect(h.out).toContain('machine    m_0000beef (box)');
    expect(h.err).toEqual(['warning: plugins tree "x" is incomplete and was ignored']);
  });

  it('--profile keeps this machine entry from the local profile', async () => {
    const local = parsed({ version: 1, plugins: {}, machines: { [SELF]: { off: [HELLO] } } });
    const h = makeDeps({ 'two.json': JSON.stringify(TWO) }, local);
    await runPluginsSetup({ profile: 'two.json' }, h.deps);
    expect(h.saved()?.plugins).toEqual(TWO.plugins);
    expect(h.saved()?.machines[SELF]?.off).toEqual([HELLO]);
  });

  it('a failed install still prints the summary, then fails the step', async () => {
    const h = makeDeps({ 'two.json': JSON.stringify(TWO) });
    vi.mocked(h.deps.install).mockRejectedValue(new Error('npm install failed'));
    await expect(runPluginsSetup({ profile: 'two.json' }, h.deps)).rejects.toThrow(
      'npm install failed'
    );
    expect(h.out[0]).toBe('machine    m_0000beef (box)');
  });

  it('--dry-run prints the plan and writes nothing', async () => {
    const h = makeDeps({ 'two.json': JSON.stringify(TWO) });
    await runPluginsSetup({ profile: 'two.json', dryRun: true }, h.deps);
    expect(h.calls).toEqual([]);
    expect(h.deps.plan).toHaveBeenCalledWith(TWO.plugins);
    expect(h.deps.loadMachine).not.toHaveBeenCalled();
    expect(h.out[0]).toBe('dry run    nothing written');
  });

  it('refuses a scope or spec violation before writing, naming plugin and rule', async () => {
    const bad = { version: 1, plugins: { '@acme/x': '^1' } };
    const h = makeDeps({
      'bad.json': JSON.stringify(bad),
      'spec.json': '{"version":1,"plugins":{"@agentage/x":"file:x"}}',
    });
    await expect(runPluginsSetup({ profile: 'bad.json' }, h.deps)).rejects.toThrow(
      'bad.json is refused:\n  plugins["@acme/x"]: refused by the scope rule'
    );
    await expect(runPluginsSetup({ profile: 'spec.json' }, h.deps)).rejects.toThrow(
      'spec.json is invalid:\n  plugins["@agentage/x"]: file: specs are refused'
    );
    expect(h.calls).toEqual([]);
  });

  it('reports unreadable, unparsable and URL profiles', async () => {
    const h = makeDeps({ 'junk.json': '{ nope' });
    await expect(runPluginsSetup({ profile: 'gone.json' }, h.deps)).rejects.toThrow(
      'cannot read profile gone.json: ENOENT: gone.json'
    );
    await expect(runPluginsSetup({ profile: 'junk.json' }, h.deps)).rejects.toThrow(
      'junk.json: not valid JSON'
    );
    await expect(runPluginsSetup({ profile: 'https://x/p.json' }, h.deps)).rejects.toThrow(
      'profile URLs are not supported'
    );
  });

  it('prints warnings of a read-only profile and installs it', async () => {
    const h = makeDeps({ 'v2.json': JSON.stringify({ ...TWO, version: 2, extra: true }) });
    await runPluginsSetup({ profile: 'v2.json' }, h.deps);
    expect(h.err.slice(0, 2)).toEqual([
      'warning: profile.json: unknown key "extra" kept',
      expect.stringContaining('version: 2 is newer'),
    ]);
  });

  it('--disconnect signs out and skips the profile flow', async () => {
    const h = makeDeps();
    await runPluginsSetup({ disconnect: true, profile: 'two.json' }, h.deps);
    expect(h.calls).toEqual(['sign-out']);
  });

  it('plain setup signs in, then falls back to the default profile locally', async () => {
    const h = makeDeps();
    await runPluginsSetup({ reauth: true, browser: false }, h.deps);
    expect(h.deps.ensureSignedIn).toHaveBeenCalledWith({ reauth: true, browser: false });
    expect(h.calls).toEqual(['sign-in', 'save', 'source:default', 'install', 'status']);
    expect(h.saved()).toEqual(defaultProfile());
    expect(h.err).toEqual([
      'cloud profile unavailable, using the default profile (saved locally, not synced)',
    ]);
    expect(h.out).toEqual(['install    2 plugins in tree abc (npm install)']);
  });

  it('plain setup installs from an existing local profile.json without rewriting it', async () => {
    const h = makeDeps({}, parsed(TWO));
    await runPluginsSetup({}, h.deps);
    expect(h.calls).toEqual(['sign-in', 'install', 'status']);
    expect(h.err).toEqual(['cloud profile unavailable, using local profile.json']);
  });

  it('plain setup prints status even when the profile step fails, then exits 1', async () => {
    const h = makeDeps({}, { ok: false, errors: ['version: must be 1 (got 0)'] });
    await expect(runPluginsSetup({}, h.deps)).rejects.toThrow(
      'profile.json is invalid:\n  version: must be 1 (got 0)'
    );
    expect(h.calls).toEqual(['sign-in', 'status']);
  });

  it('plain --dry-run plans from the local profile without signing in', async () => {
    const h = makeDeps({}, parsed(TWO));
    await runPluginsSetup({ dryRun: true }, h.deps);
    expect(h.calls).toEqual([]);
    expect(h.out[1]).toBe('profile    profile.json');
  });

  it('builds the real deps on top of the sign-in ones', () => {
    const base = makeDeps().deps;
    const deps = pluginsSetupDeps(base);
    expect(deps.ensureSignedIn).toBe(base.ensureSignedIn);
    expect(deps.scopes()).toEqual(['@agentage']);
    expect(() => deps.readFile('/nonexistent/profile.json')).toThrow();
  });
});
