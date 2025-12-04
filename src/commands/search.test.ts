// Mock dependencies first, before imports
const mockSearchAgents = jest.fn();

jest.mock('../services/registry.service.js', () => ({
  searchAgents: mockSearchAgents,
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

import { searchCommand } from './search.js';

describe('searchCommand', () => {
  let mockConsoleLog: jest.SpyInstance;
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockExit.mockRestore();
  });

  test('displays search results', async () => {
    mockSearchAgents.mockResolvedValue({
      agents: [
        {
          name: 'test-agent',
          owner: 'testuser',
          description: 'A test agent',
          latestVersion: '2025-11-30',
          totalDownloads: 42,
          tags: ['ai', 'test'],
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    });

    await searchCommand('test');

    expect(mockSearchAgents).toHaveBeenCalledWith('test', 1, 10);
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('testuser/test-agent')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('A test agent')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('42 downloads')
    );
  });

  test('shows no results message', async () => {
    mockSearchAgents.mockResolvedValue({
      agents: [],
      total: 0,
      page: 1,
      limit: 10,
      hasMore: false,
    });

    await searchCommand('nonexistent');

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No agents found')
    );
  });

  test('outputs JSON format with --json flag', async () => {
    const mockResult = {
      agents: [{ name: 'test', owner: 'user' }],
      total: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    };

    mockSearchAgents.mockResolvedValue(mockResult);

    await searchCommand('test', { json: true });

    expect(mockConsoleLog).toHaveBeenCalledWith(
      JSON.stringify(mockResult, null, 2)
    );
  });

  test('respects limit and page options', async () => {
    mockSearchAgents.mockResolvedValue({
      agents: [],
      total: 0,
      page: 2,
      limit: 5,
      hasMore: false,
    });

    await searchCommand('test', { limit: '5', page: '2' });

    expect(mockSearchAgents).toHaveBeenCalledWith('test', 2, 5);
  });

  test('shows pagination info when more results exist', async () => {
    mockSearchAgents.mockResolvedValue({
      agents: [
        {
          name: 'test',
          owner: 'user',
          latestVersion: '1.0',
          totalDownloads: 0,
        },
      ],
      total: 50,
      page: 1,
      limit: 10,
      hasMore: true,
    });

    await searchCommand('test');

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('--page 2')
    );
  });

  test('handles RegistryApiError', async () => {
    const { RegistryApiError } = require('../services/registry.service.js');
    mockSearchAgents.mockRejectedValue(
      new RegistryApiError('Rate limited', 'rate_limit', 429)
    );

    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

    await expect(searchCommand('test')).rejects.toThrow('process.exit(1)');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Rate limited')
    );

    mockConsoleError.mockRestore();
  });

  test('handles generic error', async () => {
    mockSearchAgents.mockRejectedValue(new Error('Network error'));

    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

    await expect(searchCommand('test')).rejects.toThrow('process.exit(1)');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Network error')
    );

    mockConsoleError.mockRestore();
  });

  test('displays result without description', async () => {
    mockSearchAgents.mockResolvedValue({
      agents: [
        {
          name: 'test-agent',
          owner: 'testuser',
          latestVersion: '2025-11-30',
          totalDownloads: 5,
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    });

    await searchCommand('test');

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No description')
    );
  });
});
