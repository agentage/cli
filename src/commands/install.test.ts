import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { installCommand } from './install.js';

// Mock os.homedir to isolate tests from real global agents directory
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(),
}));

// Mock dependencies
jest.mock('../services/registry.service.js', () => ({
  getAgent: jest.fn(),
  getAgentVersion: jest.fn(),
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

describe('installCommand', () => {
  const testDir = 'test-install-workspace';
  const originalCwd = process.cwd();
  let mockExit: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;

  beforeEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    jest.clearAllMocks();

    // Mock homedir to return test directory
    (homedir as jest.Mock).mockReturnValue(testDir);

    mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('rejects invalid identifier format', async () => {
    await expect(installCommand('invalid')).rejects.toThrow('process.exit(1)');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid format')
    );
  });

  test('installs agent to local directory when agent.json exists', async () => {
    const { getAgent } = require('../services/registry.service.js');

    getAgent.mockResolvedValue({
      name: 'test-agent',
      owner: 'testuser',
      latestVersion: '2025-11-30',
      latestContent: '---\nname: test-agent\n---\nContent',
    });

    writeFileSync('agent.json', JSON.stringify({ paths: ['agents/'] }));

    await installCommand('testuser/test-agent');

    expect(existsSync(join('agents', 'test-agent.agent.md'))).toBe(true);
    const content = readFileSync(
      join('agents', 'test-agent.agent.md'),
      'utf-8'
    );
    expect(content).toContain('name: test-agent');

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Installed')
    );
  });

  test('installs specific version', async () => {
    const { getAgentVersion } = require('../services/registry.service.js');

    getAgentVersion.mockResolvedValue({
      version: '2025-11-01',
      content: '---\nname: test-agent\nversion: 2025-11-01\n---\nOlder content',
    });

    writeFileSync('agent.json', '{}');

    await installCommand('testuser/test-agent@2025-11-01');

    const content = readFileSync(
      join('agents', 'test-agent.agent.md'),
      'utf-8'
    );
    expect(content).toContain('version: 2025-11-01');
  });

  test('refuses to overwrite without --force', async () => {
    const { getAgent } = require('../services/registry.service.js');

    getAgent.mockResolvedValue({
      name: 'test-agent',
      owner: 'testuser',
      latestVersion: '2025-11-30',
      latestContent: '---\nname: test-agent\n---\nNew content',
    });

    mkdirSync('agents');
    writeFileSync(join('agents', 'test-agent.agent.md'), 'existing content');
    writeFileSync('agent.json', '{}');

    try {
      await installCommand('testuser/test-agent');
      fail('Should have thrown');
    } catch {
      // Expected to exit
    }

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('already exists')
    );

    // Verify file was not overwritten
    const content = readFileSync(
      join('agents', 'test-agent.agent.md'),
      'utf-8'
    );
    expect(content).toBe('existing content');
  });

  test('overwrites with --force flag', async () => {
    const { getAgent } = require('../services/registry.service.js');

    getAgent.mockResolvedValue({
      name: 'test-agent',
      owner: 'testuser',
      latestVersion: '2025-11-30',
      latestContent: '---\nname: test-agent\n---\nNew content',
    });

    mkdirSync('agents');
    writeFileSync(join('agents', 'test-agent.agent.md'), 'existing content');
    writeFileSync('agent.json', '{}');

    await installCommand('testuser/test-agent', { force: true });

    const content = readFileSync(
      join('agents', 'test-agent.agent.md'),
      'utf-8'
    );
    expect(content).toContain('New content');
  });

  test('installs to global directory with --global flag', async () => {
    const { getAgent } = require('../services/registry.service.js');

    getAgent.mockResolvedValue({
      name: 'test-agent',
      owner: 'testuser',
      latestVersion: '2025-11-30',
      latestContent: '---\nname: test-agent\n---\nContent',
    });

    await installCommand('testuser/test-agent', { global: true });

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Installed')
    );
  });

  test('installs to local directory with --local flag', async () => {
    const { getAgent } = require('../services/registry.service.js');

    getAgent.mockResolvedValue({
      name: 'test-agent',
      owner: 'testuser',
      latestVersion: '2025-11-30',
      latestContent: '---\nname: test-agent\n---\nContent',
    });

    await installCommand('testuser/test-agent', { local: true });

    expect(existsSync(join('agents', 'test-agent.agent.md'))).toBe(true);
  });

  test('handles 404 error', async () => {
    const {
      getAgent,
      RegistryApiError,
    } = require('../services/registry.service.js');

    getAgent.mockRejectedValue(
      new RegistryApiError('Not found', 'not_found', 404)
    );

    writeFileSync('agent.json', '{}');

    await expect(installCommand('testuser/nonexistent')).rejects.toThrow(
      'process.exit(1)'
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('not found')
    );
  });

  test('handles 403 error', async () => {
    const {
      getAgent,
      RegistryApiError,
    } = require('../services/registry.service.js');

    getAgent.mockRejectedValue(
      new RegistryApiError('Forbidden', 'forbidden', 403)
    );

    writeFileSync('agent.json', '{}');

    await expect(installCommand('testuser/private-agent')).rejects.toThrow(
      'process.exit(1)'
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Access denied')
    );
  });

  test('handles version without content', async () => {
    const { getAgentVersion } = require('../services/registry.service.js');

    getAgentVersion.mockResolvedValue({
      version: '2025-11-01',
      content: null,
    });

    writeFileSync('agent.json', '{}');

    await expect(
      installCommand('testuser/test-agent@2025-11-01')
    ).rejects.toThrow('process.exit(1)');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('not available')
    );
  });

  test('handles generic error', async () => {
    const { getAgent } = require('../services/registry.service.js');

    getAgent.mockRejectedValue(new Error('Network error'));

    writeFileSync('agent.json', '{}');

    await expect(installCommand('testuser/test-agent')).rejects.toThrow(
      'process.exit(1)'
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Network error')
    );
  });
});
