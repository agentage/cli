import * as authService from '../services/auth.service.js';
import { AuthError } from '../services/auth.service.js';
import * as configUtils from '../utils/config.js';
import { whoamiCommand } from './whoami.js';

// Mock dependencies
jest.mock('../services/auth.service.js', () => {
  const original = jest.requireActual('../services/auth.service.js');
  return {
    ...original,
    getMe: jest.fn(),
  };
});
jest.mock('../utils/config.js');

const mockGetMe = authService.getMe as jest.MockedFunction<
  typeof authService.getMe
>;
const mockLoadConfig = configUtils.loadConfig as jest.MockedFunction<
  typeof configUtils.loadConfig
>;
const mockGetRegistryUrl = configUtils.getRegistryUrl as jest.MockedFunction<
  typeof configUtils.getRegistryUrl
>;
const mockIsTokenExpired = configUtils.isTokenExpired as jest.MockedFunction<
  typeof configUtils.isTokenExpired
>;

describe('whoamiCommand', () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockGetRegistryUrl.mockResolvedValue('https://dev.agentage.io');
    mockIsTokenExpired.mockReturnValue(false);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('shows not logged in when no token', async () => {
    mockLoadConfig.mockResolvedValue({});

    await whoamiCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not logged in')
    );
  });

  it('shows expired session when token is locally expired', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'expired-token', expiresAt: '2020-01-01T00:00:00Z' },
    });
    mockIsTokenExpired.mockReturnValue(true);

    await expect(whoamiCommand()).rejects.toThrow('process.exit called');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session expired')
    );
  });

  it('displays user info when authenticated', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockGetMe.mockResolvedValue({
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
    });

    await whoamiCommand();

    expect(mockGetMe).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged in to'),
      expect.any(String)
    );
  });

  it('handles session expired error', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'expired-token' },
    });
    mockGetMe.mockRejectedValue(
      new AuthError('Session expired', 'session_expired')
    );

    await expect(whoamiCommand()).rejects.toThrow('process.exit called');

    // The code logs "Session expired." (with period and emoji)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session expired')
    );
  });

  it('handles not_authenticated error', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockGetMe.mockRejectedValue(
      new AuthError('Not authenticated', 'not_authenticated')
    );

    await expect(whoamiCommand()).rejects.toThrow('process.exit called');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not logged in')
    );
  });

  it('handles other AuthError errors', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockGetMe.mockRejectedValue(new AuthError('Server error', 'server_error'));

    await expect(whoamiCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error'),
      'Server error'
    );
  });

  it('handles non-AuthError errors', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockGetMe.mockRejectedValue(new Error('Network error'));

    await expect(whoamiCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error'),
      'Network error'
    );
  });

  it('displays user without name', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockGetMe.mockResolvedValue({
      id: '123',
      email: 'test@example.com',
    });

    await whoamiCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      '  Email:',
      expect.stringContaining('test@example.com')
    );
  });

  it('displays user with verifiedAlias', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockGetMe.mockResolvedValue({
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      verifiedAlias: 'testuser',
    });

    await whoamiCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      '  Alias:',
      expect.stringContaining('testuser')
    );
  });
});
