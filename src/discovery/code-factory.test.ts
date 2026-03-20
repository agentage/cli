import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-code-${Date.now()}`);

describe('code-factory', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = join(testDir, '.agentage');
    mkdirSync(join(testDir, '.agentage'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns null for non-matching paths', async () => {
    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory('/some/file.txt');
    expect(agent).toBeNull();
  });

  it('returns null for invalid module', async () => {
    const agentDir = join(testDir, 'bad');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.js'), 'module.exports = { notAnAgent: true };');

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(join(agentDir, 'agent.js'));
    expect(agent).toBeNull();
  });

  it('matches agent.ts and agent.js files', async () => {
    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();

    // Non-matching
    expect(await factory('/path/to/other.ts')).toBeNull();
    expect(await factory('/path/to/agent.txt')).toBeNull();
  });
});
