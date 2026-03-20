import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-md-${Date.now()}`);

describe('markdown-factory', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = join(testDir, '.agentage');
    mkdirSync(join(testDir, '.agentage'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('parses .agent.md with frontmatter', async () => {
    const filePath = join(testDir, 'hello.agent.md');
    writeFileSync(
      filePath,
      '---\nname: hello\ndescription: A greeting agent\nversion: 1.0.0\ntags:\n  - greeting\n---\nYou are friendly.'
    );

    const { createMarkdownFactory } = await import('./markdown-factory.js');
    const factory = createMarkdownFactory();
    const agent = await factory(filePath);

    expect(agent).not.toBeNull();
    expect(agent!.manifest.name).toBe('hello');
    expect(agent!.manifest.description).toBe('A greeting agent');
    expect(agent!.manifest.version).toBe('1.0.0');
    expect(agent!.manifest.tags).toEqual(['greeting']);
  });

  it('returns null for non-matching paths', async () => {
    const { createMarkdownFactory } = await import('./markdown-factory.js');
    const factory = createMarkdownFactory();
    const agent = await factory('/some/file.txt');
    expect(agent).toBeNull();
  });

  it('extracts name from filename when not in frontmatter', async () => {
    const filePath = join(testDir, 'my-agent.agent.md');
    writeFileSync(filePath, '---\ndescription: Test\n---\nBody');

    const { createMarkdownFactory } = await import('./markdown-factory.js');
    const factory = createMarkdownFactory();
    const agent = await factory(filePath);

    expect(agent!.manifest.name).toBe('my-agent');
  });

  it('body becomes systemPrompt in config', async () => {
    const filePath = join(testDir, 'test.agent.md');
    writeFileSync(filePath, '---\nname: test\n---\nYou are a test agent.');

    const { createMarkdownFactory } = await import('./markdown-factory.js');
    const factory = createMarkdownFactory();
    const agent = await factory(filePath);

    expect(agent!.manifest.config?.['systemPrompt']).toBe('You are a test agent.');
  });

  it('run() yields output and result events', async () => {
    const filePath = join(testDir, 'run-test.agent.md');
    writeFileSync(filePath, '---\nname: runner\n---\nSystem prompt here.');

    const { createMarkdownFactory } = await import('./markdown-factory.js');
    const factory = createMarkdownFactory();
    const agent = await factory(filePath);
    const process = await agent!.run({ task: 'do something' });

    const events = [];
    for await (const event of process.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].data.type).toBe('output');
    expect(events.at(-1)!.data.type).toBe('result');
  });

  it('matches SKILL.md files', async () => {
    const skillDir = join(testDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, 'SKILL.md');
    writeFileSync(filePath, '---\nname: my-skill\n---\nSkill body');

    const { createMarkdownFactory } = await import('./markdown-factory.js');
    const factory = createMarkdownFactory();
    const agent = await factory(filePath);
    expect(agent).not.toBeNull();
    expect(agent!.manifest.name).toBe('my-skill');
  });
});
