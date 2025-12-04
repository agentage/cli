import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCommand } from './run.js';

describe('runCommand', () => {
  const testAgentsDir = 'test-agents';

  beforeEach(() => {
    if (existsSync(testAgentsDir)) {
      rmSync(testAgentsDir, { recursive: true });
    }
    mkdirSync(testAgentsDir);
    process.chdir(testAgentsDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.chdir('..');
    if (existsSync(testAgentsDir)) {
      rmSync(testAgentsDir, { recursive: true });
    }
  });

  test('runs agent with valid config and shows warning', async () => {
    mkdirSync('agents');
    const validAgent = `name: test-agent
model: gpt-4
instructions: Test instructions
tools: []
variables: {}`;
    writeFileSync(join('agents', 'test-agent.yml'), validAgent);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await runCommand('test-agent', 'Hello');

    expect(consoleLog).toHaveBeenCalledWith('\n🤖 Running test-agent...\n');
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Agent runtime not available')
    );

    consoleLog.mockRestore();
  });

  test('uses default prompt when none provided', async () => {
    mkdirSync('agents');
    const validAgent = `name: test-agent
model: gpt-4
instructions: Test instructions
tools: []
variables: {}`;
    writeFileSync(join('agents', 'test-agent.yml'), validAgent);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    await runCommand('test-agent');

    expect(consoleLog).toHaveBeenCalledWith('\n🤖 Running test-agent...\n');

    consoleLog.mockRestore();
  });

  test('handles missing agent file', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    await expect(runCommand('nonexistent')).rejects.toThrow(
      'process.exit called'
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed:')
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    consoleError.mockRestore();
  });

  test('handles invalid agent YAML', async () => {
    mkdirSync('agents');
    const invalidAgent = `name: test-agent
model: gpt-4`;
    writeFileSync(join('agents', 'invalid.yml'), invalidAgent);

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    await expect(runCommand('invalid')).rejects.toThrow('process.exit called');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed:')
    );

    mockExit.mockRestore();
    consoleError.mockRestore();
  });
});
