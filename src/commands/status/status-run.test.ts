import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { type StatusReport } from '../../lib/status/status-info.js';
import { type ExtensionsGather } from '../extension/rows.js';
import { printStatus, registerStatus, runStatus, type StatusDeps } from './status.js';

const baseReport: StatusReport = {
  version: '0.25.0',
  fqdn: 'agentage.io',
  env: 'production',
  target: { fqdn: 'agentage.io', env: 'production', reachable: true },
  auth: { signedIn: true },
  endpoint: { url: 'https://agentage.io/api', reachable: true },
  update: { status: { kind: 'current' }, message: null },
};

const captureLines = (report: StatusReport): string => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    printStatus(report);
    return spy.mock.calls.map((call) => String(call[0])).join('\n');
  } finally {
    spy.mockRestore();
  }
};

const gathered: ExtensionsGather = {
  status: {
    machine: { id: 'm_0000beef', name: 'box' },
    profile: { state: 'ok', version: 1, source: 'default', readOnly: false, etag: null },
    plan: { add: 0, update: 0, remove: 0, off: 0, unchanged: 0 },
    extensions: [],
  },
  warnings: ['profile.json: unknown key "x" kept'],
  drift: [],
  verbs: { top: new Map(), namespaced: [] },
};

const capture = async (deps: StatusDeps, json = false) => {
  const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const error = await runStatus({ json }, deps).then(
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

const depsWith = (extensions: StatusDeps['extensions']): StatusDeps => ({
  gather: () => Promise.resolve(baseReport),
  extensions,
});

describe('runStatus', () => {
  it("appends only machine, profile, the extension count and the plan after today's lines and keys", async () => {
    const human = await capture(depsWith(() => Promise.resolve(gathered)));
    expect(human.stdout).toBe(
      [
        captureLines(baseReport),
        'machine    m_0000beef (box)',
        'profile    version 1 (source: default)',
        'extensions 0',
      ].join('\n')
    );
    expect(human.stderr).toContain('warning: profile.json: unknown key "x" kept');
    const json = await capture(
      depsWith(() => Promise.resolve(gathered)),
      true
    );
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      ...Object.keys(baseReport),
      'machine',
      'profile',
      'extensions',
      'plan',
    ]);
    expect(parsed['extensions']).toBe(0);
    expect(parsed['plan']).toEqual(gathered.status.plan);
  });

  it('prints the report, then fails the step on an invalid profile', async () => {
    const invalid: ExtensionsGather = {
      status: {
        ...gathered.status,
        profile: { state: 'invalid', errors: ['extensions["x"]: bad'] },
      },
      warnings: [],
      drift: [],
      verbs: gathered.verbs,
    };
    const result = await capture(
      depsWith(() => Promise.resolve(invalid)),
      true
    );
    expect(JSON.parse(result.stdout)).toMatchObject({ profile: { state: 'invalid' } });
    expect(String(result.error)).toContain('profile.json is invalid:\n  extensions["x"]: bad');
  });

  it("prints today's report even when the extension side throws", async () => {
    const result = await capture(depsWith(() => Promise.reject(new Error('EACCES machine.json'))));
    expect(result.stdout).toBe(captureLines(baseReport));
    expect(String(result.error)).toContain('EACCES machine.json');
  });
});

describe('registerStatus help', () => {
  const helpOf = (): string => {
    let text = '';
    const program = new Command().configureOutput({ writeOut: (chunk) => void (text += chunk) });
    registerStatus(program, () => Promise.resolve());
    program.commands.find((c) => c.name() === 'status')?.outputHelp();
    return text;
  };

  it('describes the machine, profile and extension lines, with no switch to turn them on', () => {
    const help = helpOf();
    expect(help).toContain('machine, profile, and extension status');
    expect(help).toContain('agentage extension list shows one row per extension');
    expect(help).not.toContain('AGENTAGE_EXTENSIONS');
  });
});
