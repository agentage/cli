import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { publishCommand } from './publish.js';

// Mock dependencies
jest.mock('../utils/config.js', () => ({
  getAuthStatus: jest.fn(),
  getRegistryUrl: jest.fn().mockResolvedValue('https://dev.agentage.io'),
}));

jest.mock('../services/registry.service.js', () => ({
  publishAgent: jest.fn(),
  RegistryApiError: class extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number
    ) {
      super(message);
    }
  },
}));

describe('publishCommand', () => {
  const testDir = 'test-publish-workspace';
  const originalCwd = process.cwd();

  beforeEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('requires authentication', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    getAuthStatus.mockResolvedValue({ status: 'not_authenticated' });

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand()).rejects.toThrow('process.exit');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Not logged in')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('shows expired session message', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    getAuthStatus.mockResolvedValue({ status: 'expired' });

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand()).rejects.toThrow('process.exit');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Session expired')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('finds agent file in current directory', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    const { publishAgent } = require('../services/registry.service.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });
    publishAgent.mockResolvedValue({
      name: 'my-agent',
      owner: 'testuser',
      version: '2025-11-30',
    });

    const agentContent = `---
name: my-agent
description: Test agent
---
You are helpful.`;
    writeFileSync('my-agent.agent.md', agentContent);

    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await publishCommand();

    expect(publishAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-agent',
        visibility: 'public',
      })
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Published')
    );

    mockConsoleLog.mockRestore();
  });

  test('supports dry run', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    const { publishAgent } = require('../services/registry.service.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });

    const agentContent = `---
name: my-agent
description: Test agent
---
You are helpful.`;
    writeFileSync('my-agent.agent.md', agentContent);

    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await publishCommand(undefined, { dryRun: true });

    expect(publishAgent).not.toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Dry run')
    );

    mockConsoleLog.mockRestore();
  });

  test('validates agent name', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });

    const agentContent = `---
name: Invalid-Name
---
Content`;
    writeFileSync('agent.agent.md', agentContent);

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand()).rejects.toThrow('process.exit');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid agent name')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('finds agent with explicit path', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    const { publishAgent } = require('../services/registry.service.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });
    publishAgent.mockResolvedValue({
      name: 'my-agent',
      owner: 'testuser',
      version: '2025-11-30',
    });

    const agentContent = `---
name: my-agent
description: Test agent
---
You are helpful.`;
    writeFileSync('my-agent.agent.md', agentContent);

    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await publishCommand('my-agent.agent.md');

    expect(publishAgent).toHaveBeenCalled();
    mockConsoleLog.mockRestore();
  });

  test('finds agent with name without extension', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    const { publishAgent } = require('../services/registry.service.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });
    publishAgent.mockResolvedValue({
      name: 'my-agent',
      owner: 'testuser',
      version: '2025-11-30',
    });

    const agentContent = `---
name: my-agent
---
Content`;
    writeFileSync('my-agent.agent.md', agentContent);

    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await publishCommand('my-agent');

    expect(publishAgent).toHaveBeenCalled();
    mockConsoleLog.mockRestore();
  });

  test('finds agent in agents directory', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    const { publishAgent } = require('../services/registry.service.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });
    publishAgent.mockResolvedValue({
      name: 'my-agent',
      owner: 'testuser',
      version: '2025-11-30',
    });

    mkdirSync('agents');
    const agentContent = `---
name: my-agent
---
Content`;
    writeFileSync('agents/my-agent.agent.md', agentContent);

    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await publishCommand('my-agent');

    expect(publishAgent).toHaveBeenCalled();
    mockConsoleLog.mockRestore();
  });

  test('fails when no agent file found', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand('nonexistent')).rejects.toThrow('process.exit');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('No agent file found')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('fails when agent has no name', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });

    const agentContent = `---
description: No name agent
---
Content`;
    writeFileSync('agent.agent.md', agentContent);

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand()).rejects.toThrow('process.exit');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('must have a name')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('shows multiple agent files warning', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });

    writeFileSync('agent1.agent.md', '---\nname: a1\n---\n');
    writeFileSync('agent2.agent.md', '---\nname: a2\n---\n');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand()).rejects.toThrow('process.exit');

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Multiple agent files found')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('handles RegistryApiError', async () => {
    const { getAuthStatus } = require('../utils/config.js');
    const {
      publishAgent,
      RegistryApiError,
    } = require('../services/registry.service.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });
    publishAgent.mockRejectedValue(
      new RegistryApiError('Version exists', 'version_exists', 409)
    );

    const agentContent = `---
name: my-agent
---
Content`;
    writeFileSync('my-agent.agent.md', agentContent);

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await expect(publishCommand()).rejects.toThrow('process.exit');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Version exists')
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('dry run shows all options', async () => {
    const { getAuthStatus } = require('../utils/config.js');

    getAuthStatus.mockResolvedValue({
      status: 'authenticated',
      token: 'test-token',
    });

    const agentContent = `---
name: my-agent
description: A test agent
version: 1.0.0
---
Content`;
    writeFileSync('my-agent.agent.md', agentContent);

    const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

    await publishCommand(undefined, {
      dryRun: true,
      tag: ['ai', 'test'],
      changelog: 'Initial release',
    });

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Tags')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Changelog')
    );

    mockConsoleLog.mockRestore();
  });
});
