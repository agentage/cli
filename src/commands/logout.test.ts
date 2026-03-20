import * as authService from '../services/auth.service.js';
import * as configUtils from '../utils/config.js';
import { logoutCommand } from './logout.js';

// Mock dependencies
jest.mock('../services/auth.service.js');
jest.mock('../utils/config.js');

const mockLogout = authService.logout as jest.MockedFunction<typeof authService.logout>;
const mockLoadAuth = configUtils.loadAuth as jest.MockedFunction<typeof configUtils.loadAuth>;
const mockClearAuth = configUtils.clearAuth as jest.MockedFunction<typeof configUtils.clearAuth>;

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
    mockLoadAuth.mockResolvedValue({});

    await logoutCommand();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    expect(mockClearAuth).not.toHaveBeenCalled();
  });

  it('clears credentials and shows success', async () => {
    mockLoadAuth.mockResolvedValue({
      token: 'test-token',
      user: { id: '1', email: 'test@example.com', name: 'Test User' },
    });
    mockLogout.mockResolvedValue(undefined);
    mockClearAuth.mockResolvedValue(undefined);

    await logoutCommand();

    expect(mockLogout).toHaveBeenCalled();
    expect(mockClearAuth).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Logged out from'),
      expect.stringContaining('Test User')
    );
  });

  it('clears credentials even when server logout fails', async () => {
    mockLoadAuth.mockResolvedValue({ token: 'test-token' });
    mockLogout.mockRejectedValue(new Error('Network error'));
    mockClearAuth.mockResolvedValue(undefined);

    await logoutCommand();

    expect(mockClearAuth).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Logged out locally'));
  });
});
