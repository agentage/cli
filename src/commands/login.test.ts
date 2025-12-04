import * as authService from '../services/auth.service.js';
import { AuthError } from '../services/auth.service.js';
import * as configUtils from '../utils/config.js';
import { loginCommand } from './login.js';

// Mock dependencies
jest.mock('../services/auth.service.js', () => {
  const original = jest.requireActual('../services/auth.service.js');
  return {
    ...original,
    requestDeviceCode: jest.fn(),
    pollForToken: jest.fn(),
  };
});
jest.mock('../utils/config.js');
jest.mock('open', () => ({
  default: jest.fn(),
}));

const mockRequestDeviceCode =
  authService.requestDeviceCode as jest.MockedFunction<
    typeof authService.requestDeviceCode
  >;
const mockPollForToken = authService.pollForToken as jest.MockedFunction<
  typeof authService.pollForToken
>;
const mockLoadConfig = configUtils.loadConfig as jest.MockedFunction<
  typeof configUtils.loadConfig
>;
const mockSaveConfig = configUtils.saveConfig as jest.MockedFunction<
  typeof configUtils.saveConfig
>;
const mockGetRegistryUrl = configUtils.getRegistryUrl as jest.MockedFunction<
  typeof configUtils.getRegistryUrl
>;

describe('loginCommand', () => {
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
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('shows message when already logged in', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'existing-token' },
    });

    await loginCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Already logged in'),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });

  it('completes login flow successfully', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockResolvedValue({
      device_code: 'device123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://dev.agentage.io/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForToken.mockResolvedValue({
      access_token: 'new-token',
      token_type: 'Bearer',
      user: { id: '1', email: 'test@example.com', name: 'Test User' },
    });
    mockSaveConfig.mockResolvedValue(undefined);

    await loginCommand();

    expect(mockRequestDeviceCode).toHaveBeenCalled();
    expect(mockPollForToken).toHaveBeenCalledWith('device123', 5, 900);
    expect(mockSaveConfig).toHaveBeenCalledWith({
      auth: {
        token: 'new-token',
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        expiresAt: undefined,
      },
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged in as'),
      expect.stringContaining('Test User')
    );
  });

  it('handles login errors', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockRejectedValue(
      new AuthError('Failed', 'request_failed')
    );

    await expect(loginCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Login failed'),
      'Failed'
    );
  });

  it('handles expired token error with hint', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockResolvedValue({
      device_code: 'device123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://dev.agentage.io/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForToken.mockRejectedValue(
      new AuthError('Login timed out', 'expired_token')
    );

    await expect(loginCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Login failed'),
      'Login timed out'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Run'),
      expect.stringContaining('agent login'),
      expect.stringContaining('to try again')
    );
  });

  it('handles non-AuthError errors', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockRejectedValue(new Error('Network error'));

    await expect(loginCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Login failed'),
      'Network error'
    );
  });

  it('shows email when user has no name', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockResolvedValue({
      device_code: 'device123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://dev.agentage.io/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForToken.mockResolvedValue({
      access_token: 'new-token',
      token_type: 'Bearer',
      user: { id: '1', email: 'test@example.com' },
    });
    mockSaveConfig.mockResolvedValue(undefined);

    await loginCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged in as'),
      expect.stringContaining('test@example.com')
    );
  });

  it('shows generic success when no user info', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockResolvedValue({
      device_code: 'device123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://dev.agentage.io/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForToken.mockResolvedValue({
      access_token: 'new-token',
      token_type: 'Bearer',
    });
    mockSaveConfig.mockResolvedValue(undefined);

    await loginCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Login successful')
    );
  });

  it('handles browser open failure gracefully', async () => {
    // Mock open to throw an error
    jest.doMock('open', () => ({
      default: jest.fn().mockRejectedValue(new Error('Cannot open browser')),
    }));

    mockLoadConfig.mockResolvedValue({});
    mockRequestDeviceCode.mockResolvedValue({
      device_code: 'device123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://dev.agentage.io/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForToken.mockResolvedValue({
      access_token: 'new-token',
      token_type: 'Bearer',
      user: { id: '1', email: 'test@example.com', name: 'Test User' },
    });
    mockSaveConfig.mockResolvedValue(undefined);

    await loginCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged in as'),
      expect.stringContaining('Test User')
    );
  });
});
