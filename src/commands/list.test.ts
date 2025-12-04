import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { listCommand } from './list.js';

// Mock os.homedir to isolate tests from real global agents
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(),
}));

describe('listCommand', () => {
  const testAgentsDir = 'test-agents';
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Ensure we're in the original directory
    process.chdir(originalCwd);

    if (existsSync(testAgentsDir)) {
      rmSync(testAgentsDir, { recursive: true, force: true });
    }
    mkdirSync(testAgentsDir, { recursive: true });
    process.chdir(testAgentsDir);

    // Mock homedir to return test directory (no global agents)
    (homedir as jest.Mock).mockReturnValue(testAgentsDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testAgentsDir)) {
      rmSync(testAgentsDir, { recursive: true, force: true });
    }
  });

  test('shows message when no agents directory exists', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No agents found.')
    );

    consoleLog.mockRestore();
  });

  test('shows message when agents directory is empty', async () => {
    mkdirSync('agents');
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No agents found.')
    );

    consoleLog.mockRestore();
  });

  test('lists valid agent yml files', async () => {
    mkdirSync('agents');
    const validAgent = `name: test-agent
model: gpt-4
instructions: Test instructions
tools: []
variables: {}`;
    writeFileSync(join('agents', 'test-agent.yml'), validAgent);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith('\n📋 Available Agents:\n');
    expect(consoleLog).toHaveBeenCalledWith('  📁 Local:');
    expect(consoleLog).toHaveBeenCalledWith('    ✅ test-agent (gpt-4)');

    consoleLog.mockRestore();
  });

  test('lists valid agent.md files', async () => {
    mkdirSync('agents');
    const validAgentMd = `---
name: my-agent
description: Test agent
model: gpt-4o
---
You are a helpful assistant.`;
    writeFileSync(join('agents', 'my-agent.agent.md'), validAgentMd);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith('\n📋 Available Agents:\n');
    expect(consoleLog).toHaveBeenCalledWith('  📁 Local:');
    expect(consoleLog).toHaveBeenCalledWith('    ✅ my-agent (gpt-4o)');

    consoleLog.mockRestore();
  });

  test('shows validation errors for invalid agent files', async () => {
    mkdirSync('agents');
    const invalidAgent = `invalid: yaml
content: here`;
    writeFileSync(join('agents', 'invalid-agent.yml'), invalidAgent);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith('\n📋 Available Agents:\n');
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('❌ invalid-agent -')
    );

    consoleLog.mockRestore();
  });

  test('lists both valid and invalid agents', async () => {
    mkdirSync('agents');

    const validAgent = `name: valid-agent
model: gpt-4
instructions: Test instructions
tools: []
variables: {}`;
    writeFileSync(join('agents', 'valid-agent.yml'), validAgent);

    const invalidAgent = `name: missing-instructions
model: gpt-4`;
    writeFileSync(join('agents', 'invalid-agent.yml'), invalidAgent);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith('    ✅ valid-agent (gpt-4)');
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('❌ invalid-agent -')
    );

    consoleLog.mockRestore();
  });

  test('uses paths from agent.json config', async () => {
    mkdirSync('custom-agents');
    const config = { paths: ['custom-agents/'] };
    writeFileSync('agent.json', JSON.stringify(config));

    const validAgent = `name: custom-agent
model: gpt-4
instructions: Test instructions`;
    writeFileSync(join('custom-agents', 'custom-agent.yml'), validAgent);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith('    ✅ custom-agent (gpt-4)');

    consoleLog.mockRestore();
  });

  test('handles errors gracefully', async () => {
    mkdirSync('agents');
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await listCommand();

    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No agents found.')
    );

    consoleLog.mockRestore();
  });
});
