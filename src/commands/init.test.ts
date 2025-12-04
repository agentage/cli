import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { initCommand } from './init.js';

describe('initCommand', () => {
  const testDir = 'test-init-workspace';
  const globalDir = join(homedir(), '.agentage');

  beforeEach(() => {
    // Create and change to test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir);
    process.chdir(testDir);
  });

  afterEach(() => {
    // Return to parent and clean up
    process.chdir('..');
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  test('creates agent.json in current directory and agents folder with default name', async () => {
    await initCommand();

    const agentFilePath = join('agents', 'my-agent.agent.md');
    const configFilePath = 'agent.json';

    expect(existsSync('agents')).toBe(true);
    expect(existsSync(agentFilePath)).toBe(true);
    expect(existsSync(configFilePath)).toBe(true);

    const agentContent = readFileSync(agentFilePath, 'utf-8');
    expect(agentContent).toContain('name: my-agent');
    expect(agentContent).toContain('You are a helpful AI assistant');

    const configContent = JSON.parse(readFileSync(configFilePath, 'utf-8'));
    expect(configContent.paths).toEqual(['agents/']);
  });

  test('creates agent file with custom name', async () => {
    await initCommand('custom-agent');

    const agentFilePath = join('agents', 'custom-agent.agent.md');

    expect(existsSync('agents')).toBe(true);
    expect(existsSync(agentFilePath)).toBe(true);

    const agentContent = readFileSync(agentFilePath, 'utf-8');
    expect(agentContent).toContain('name: custom-agent');
  });

  test('creates agent.json config with path property', async () => {
    await initCommand('test-agent');

    const configFilePath = 'agent.json';
    expect(existsSync(configFilePath)).toBe(true);

    const configContent = JSON.parse(readFileSync(configFilePath, 'utf-8'));
    expect(configContent).toEqual({ paths: ['agents/'] });
  });

  test('handles errors gracefully', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const originalWriteFile = require('fs/promises').writeFile;
    jest
      .spyOn(require('fs/promises'), 'writeFile')
      .mockRejectedValue(new Error('Write failed'));

    await expect(initCommand('test')).rejects.toThrow('process.exit called');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed: Write failed')
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    // Restore
    require('fs/promises').writeFile = originalWriteFile;
    mockExit.mockRestore();
    consoleError.mockRestore();
  });

  test('creates agent in global directory with --global flag', async () => {
    await initCommand('global-agent', { global: true });

    const globalAgentFilePath = join(globalDir, 'agents', 'global-agent.agent.md');
    const globalConfigFilePath = join(globalDir, 'agent.json');

    expect(existsSync(join(globalDir, 'agents'))).toBe(true);
    expect(existsSync(globalAgentFilePath)).toBe(true);
    expect(existsSync(globalConfigFilePath)).toBe(true);

    const agentContent = readFileSync(globalAgentFilePath, 'utf-8');
    expect(agentContent).toContain('name: global-agent');

    const configContent = JSON.parse(readFileSync(globalConfigFilePath, 'utf-8'));
    expect(configContent.paths).toEqual(['agents/']);

    // Cleanup global test files
    rmSync(globalAgentFilePath);
  });
});
