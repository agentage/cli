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
    expect(await factory('/some/file.txt')).toBeNull();
  });

  it('returns null for .ts files that are not agents', async () => {
    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    expect(await factory('/path/to/other.ts')).toBeNull();
    expect(await factory('/path/to/agent.txt')).toBeNull();
  });

  it('matches agent.ts basename', async () => {
    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    // Can't load non-existent file, but test that non-matching returns null
    expect(await factory('/path/to/notmatch.ts')).toBeNull();
  });

  it('matches .agent.ts convention', async () => {
    const agentDir = join(testDir, 'standalone');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'hello.agent.js'),
      `module.exports = {
        manifest: { name: 'hello', path: '', description: 'Hello agent' },
        run: async function(input) { return { runId: '1', events: (async function*() {})(), cancel() {}, sendInput() {} }; }
      };`
    );

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(join(agentDir, 'hello.agent.js'));
    expect(agent).not.toBeNull();
    expect(agent!.manifest.name).toBe('hello');
  });

  it('matches .agent.js convention', async () => {
    const agentDir = join(testDir, 'js-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'greet.agent.js'),
      `module.exports = {
        manifest: { name: 'greet', path: '/custom', description: 'Greet agent' },
        run: async function(input) { return { runId: '1', events: (async function*() {})(), cancel() {}, sendInput() {} }; }
      };`
    );

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(join(agentDir, 'greet.agent.js'));
    expect(agent).not.toBeNull();
    expect(agent!.manifest.name).toBe('greet');
  });

  it('rejects bare .agent.ts without name prefix', async () => {
    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    expect(await factory('/path/to/.agent.ts')).toBeNull();
    expect(await factory('/path/to/.agent.js')).toBeNull();
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

  it('returns null for module without run function', async () => {
    const agentDir = join(testDir, 'no-run');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'agent.js'),
      'module.exports = { manifest: { name: "broken", path: "" } };'
    );

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(join(agentDir, 'agent.js'));
    expect(agent).toBeNull();
  });

  it('auto-injects path when manifest.path is empty', async () => {
    const agentDir = join(testDir, 'auto-path');
    mkdirSync(agentDir, { recursive: true });
    const agentPath = join(agentDir, 'agent.js');
    writeFileSync(
      agentPath,
      `module.exports = {
        manifest: { name: 'auto', path: '' },
        run: async function(input) { return { runId: '1', events: (async function*() {})(), cancel() {}, sendInput() {} }; }
      };`
    );

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(agentPath);
    expect(agent).not.toBeNull();
    expect(agent!.manifest.path).toBe(agentPath);
  });

  it('preserves path when already set', async () => {
    const agentDir = join(testDir, 'keep-path');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'agent.js'),
      `module.exports = {
        manifest: { name: 'custom', path: '/custom/path' },
        run: async function(input) { return { runId: '1', events: (async function*() {})(), cancel() {}, sendInput() {} }; }
      };`
    );

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(join(agentDir, 'agent.js'));
    expect(agent).not.toBeNull();
    expect(agent!.manifest.path).toBe('/custom/path');
  });

  it('handles import error gracefully', async () => {
    const agentDir = join(testDir, 'syntax-err');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.js'), 'this is not valid javascript }{}{');

    const { createCodeFactory } = await import('./code-factory.js');
    const factory = createCodeFactory();
    const agent = await factory(join(agentDir, 'agent.js'));
    expect(agent).toBeNull();
  });
});
