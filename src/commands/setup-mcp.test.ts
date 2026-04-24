import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetupMcp } from './setup-mcp.js';

describe('runSetupMcp', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'setup-mcp-'));
    home = mkdtempSync(join(tmpdir(), 'setup-mcp-home-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('creates .mcp.json and .vscode/mcp.json with npx entry by default', () => {
    const results = runSetupMcp({ cwd: dir, home });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.action).sort()).toEqual(['created', 'created']);

    const project = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(project.mcpServers.agentage).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@agentage/mcp'],
    });

    const vscode = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
    expect(vscode.servers.agentage).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@agentage/mcp'],
    });
  });

  it('style=binary writes direct agentage-mcp command', () => {
    runSetupMcp({ cwd: dir, home, style: 'binary' });
    const project = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(project.mcpServers.agentage).toEqual({
      type: 'stdio',
      command: 'agentage-mcp',
      args: [],
    });
  });

  it('noProject=true skips .mcp.json', () => {
    const results = runSetupMcp({ cwd: dir, home, noProject: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe('vscode-workspace');
  });

  it('noVscode=true skips .vscode/mcp.json', () => {
    const results = runSetupMcp({ cwd: dir, home, noVscode: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe('claude-code-project');
  });

  it('both flags together in project scope throws', () => {
    expect(() => runSetupMcp({ cwd: dir, home, noProject: true, noVscode: true })).toThrow(
      /no targets selected/
    );
  });

  it('scope=user writes ~/.claude.json and leaves cwd untouched', () => {
    const results = runSetupMcp({ cwd: dir, home, scope: 'user' });
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe('claude-code-user');

    const userConfig = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8'));
    expect(userConfig.mcpServers.agentage).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@agentage/mcp'],
    });

    // cwd untouched
    expect(() => readFileSync(join(dir, '.mcp.json'), 'utf-8')).toThrow();
  });

  it('scope=all writes project + vscode + user', () => {
    const results = runSetupMcp({ cwd: dir, home, scope: 'all' });
    const kinds = results.map((r) => r.kind).sort();
    expect(kinds).toEqual(['claude-code-project', 'claude-code-user', 'vscode-workspace']);
  });

  it('scope=user preserves unrelated top-level fields in ~/.claude.json', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        projects: { '/somewhere': { lastOpened: 123 } },
        oauthAccount: { emailAddress: 'x@y.z' },
      })
    );

    runSetupMcp({ cwd: dir, home, scope: 'user' });

    const userConfig = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8'));
    expect(userConfig.projects['/somewhere'].lastOpened).toBe(123);
    expect(userConfig.oauthAccount.emailAddress).toBe('x@y.z');
    expect(userConfig.mcpServers.agentage).toBeDefined();
  });

  it('preserves unrelated mcpServers entries', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            other: { type: 'stdio', command: 'other', args: [] },
          },
        },
        null,
        2
      )
    );

    runSetupMcp({ cwd: dir, home, noVscode: true });

    const project = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(project.mcpServers.other).toEqual({ type: 'stdio', command: 'other', args: [] });
    expect(project.mcpServers.agentage.command).toBe('npx');
  });

  it('returns unchanged when entry already matches', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            agentage: { type: 'stdio', command: 'npx', args: ['-y', '@agentage/mcp'] },
          },
        },
        null,
        2
      )
    );

    const results = runSetupMcp({ cwd: dir, home, noVscode: true });
    expect(results[0]?.action).toBe('unchanged');
  });

  it('skips with reason when existing entry differs and force is off', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            agentage: { type: 'stdio', command: 'agentage-mcp', args: [] },
          },
        },
        null,
        2
      )
    );

    const results = runSetupMcp({ cwd: dir, home, noVscode: true });
    expect(results[0]?.action).toBe('skipped');
    expect(results[0]?.reason).toMatch(/--force/);

    const project = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(project.mcpServers.agentage.command).toBe('agentage-mcp');
  });

  it('force=true overwrites a differing entry', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            agentage: { type: 'stdio', command: 'agentage-mcp', args: [] },
          },
        },
        null,
        2
      )
    );

    const results = runSetupMcp({ cwd: dir, home, noVscode: true, force: true });
    expect(results[0]?.action).toBe('updated');

    const project = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(project.mcpServers.agentage.command).toBe('npx');
  });

  it('creates .vscode directory when missing', () => {
    runSetupMcp({ cwd: dir, home, noProject: true });
    const vscode = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
    expect(vscode.servers.agentage).toBeDefined();
  });

  it('refuses to overwrite a malformed existing config', () => {
    writeFileSync(join(dir, '.mcp.json'), 'not-json-at-all');
    expect(() => runSetupMcp({ cwd: dir, home, noVscode: true })).toThrow(/not a JSON object/);
  });

  it('adds agentage entry when config exists but has no mcpServers key', () => {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, '.vscode', 'mcp.json'), JSON.stringify({ otherField: true }));

    const results = runSetupMcp({ cwd: dir, home, noProject: true });
    expect(results[0]?.action).toBe('added');

    const vscode = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
    expect(vscode.otherField).toBe(true);
    expect(vscode.servers.agentage).toBeDefined();
  });
});
