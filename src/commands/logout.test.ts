import * as authService from '../services/auth.service.js';
import * as configUtils from '../utils/config.js';
import { logoutCommand } from './logout.js';

// Mock dependencies
jest.mock('../services/auth.service.js');
jest.mock('../utils/config.js');

const mockLogout = authService.logout as jest.MockedFunction<
  typeof authService.logout
>;
const mockLoadConfig = configUtils.loadConfig as jest.MockedFunction<
  typeof configUtils.loadConfig
>;
const mockClearConfig = configUtils.clearConfig as jest.MockedFunction<
  typeof configUtils.clearConfig
>;

describe('logoutCommand', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('shows message when not logged in', async () => {
    mockLoadConfig.mockResolvedValue({});

    await logoutCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not logged in')
    );
    expect(mockClearConfig).not.toHaveBeenCalled();
  });

  it('clears credentials and shows success', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: {
        token: 'test-token',
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
      },
    });
    mockLogout.mockResolvedValue(undefined);
    mockClearConfig.mockResolvedValue(undefined);

    await logoutCommand();

    expect(mockLogout).toHaveBeenCalled();
    expect(mockClearConfig).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged out from'),
      expect.stringContaining('Test User')
    );
  });

  it('clears credentials even when server logout fails', async () => {
    mockLoadConfig.mockResolvedValue({
      auth: { token: 'test-token' },
    });
    mockLogout.mockRejectedValue(new Error('Network error'));
    mockClearConfig.mockResolvedValue(undefined);

    await logoutCommand();

    expect(mockClearConfig).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged out locally')
    );
  });
});
