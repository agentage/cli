import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type AgentFactory } from '@agentage/core';

const testDir = join(tmpdir(), `agentage-test-scanner-${Date.now()}`);

describe('scanner', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = join(testDir, '.agentage');
    mkdirSync(join(testDir, '.agentage'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('scans directory and returns agents from matching factories', async () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'hello.agent.md'), '---\nname: hello\n---\nHi');

    const factory: AgentFactory = async (path) => {
      if (!path.endsWith('.agent.md')) return null;
      return {
        manifest: { name: 'hello', description: 'Test', path },
        async run() {
          return {
            runId: 'test',
            events: (async function* () {})(),
            cancel: () => {},
            sendInput: () => {},
          };
        },
      };
    };

    const { scanAgents } = await import('./scanner.js');
    const agents = await scanAgents([agentsDir], [factory]);
    expect(agents).toHaveLength(1);
    expect(agents[0].manifest.name).toBe('hello');
  });

  it('skips non-matching files', async () => {
    const agentsDir = join(testDir, 'agents2');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'readme.txt'), 'not an agent');

    const factory: AgentFactory = async () => null;

    const { scanAgents } = await import('./scanner.js');
    const agents = await scanAgents([agentsDir], [factory]);
    expect(agents).toHaveLength(0);
  });

  it('handles non-existent directories', async () => {
    const { scanAgents } = await import('./scanner.js');
    const agents = await scanAgents([join(testDir, 'nope')], []);
    expect(agents).toHaveLength(0);
  });

  it('deduplicates agents by name', async () => {
    const agentsDir = join(testDir, 'agents3');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'a.agent.md'), '---\nname: dupe\n---\n');
    writeFileSync(join(agentsDir, 'b.agent.md'), '---\nname: dupe\n---\n');

    const factory: AgentFactory = async (path) => {
      if (!path.endsWith('.agent.md')) return null;
      return {
        manifest: { name: 'dupe', path },
        async run() {
          return {
            runId: 'x',
            events: (async function* () {})(),
            cancel: () => {},
            sendInput: () => {},
          };
        },
      };
    };

    const { scanAgents } = await import('./scanner.js');
    const agents = await scanAgents([agentsDir], [factory]);
    expect(agents).toHaveLength(1);
  });

  // ─── QW-3: scan warnings ──────────────────────────────────

  it('collects factory errors as warnings', async () => {
    const agentsDir = join(testDir, 'agents-warn');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'broken.agent.md'), '---\nname: broken\n---\n');

    const throwingFactory: AgentFactory = async (path) => {
      if (path.endsWith('.agent.md')) throw new Error('Import failed: missing module');
      return null;
    };

    const { scanAgents, getLastScanWarnings } = await import('./scanner.js');
    await scanAgents([agentsDir], [throwingFactory]);

    const warnings = getLastScanWarnings();
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].file).toContain('broken.agent.md');
    expect(warnings[0].message).toContain('Import failed');
  });

  it('clears warnings on each scan', async () => {
    const agentsDir = join(testDir, 'agents-clear');
    mkdirSync(agentsDir, { recursive: true });

    const okFactory: AgentFactory = async () => null;

    const { scanAgents, getLastScanWarnings } = await import('./scanner.js');
    await scanAgents([agentsDir], [okFactory]);

    const warnings = getLastScanWarnings();
    expect(warnings).toHaveLength(0);
  });
});
