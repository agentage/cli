const mockExecAsync = jest.fn();

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('util', () => ({
  promisify: (): typeof mockExecAsync => mockExecAsync,
}));

import { updateCommand } from './update.js';

describe('updateCommand', () => {
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
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('shows message when already on latest version', async () => {
    mockExecAsync.mockImplementation((command: string) => {
      if (command.includes('npm list')) {
        return Promise.resolve({
          stdout: JSON.stringify({
            dependencies: { '@agentage/cli': { version: '1.0.0' } },
          }),
        });
      } else if (command.includes('npm view')) {
        return Promise.resolve({ stdout: '1.0.0\n' });
      }
      return Promise.resolve({ stdout: '' });
    });

    await updateCommand();

    expect(consoleSpy).toHaveBeenCalledWith('🔄 Checking for updates...');
    expect(consoleSpy).toHaveBeenCalledWith(
      '✅ Already on the latest version (1.0.0)'
    );
  });

  it('updates successfully when new version available', async () => {
    let listCallCount = 0;
    mockExecAsync.mockImplementation((command: string) => {
      if (command.includes('npm list')) {
        listCallCount++;
        const version = listCallCount === 1 ? '1.0.0' : '2.0.0';
        return Promise.resolve({
          stdout: JSON.stringify({
            dependencies: { '@agentage/cli': { version } },
          }),
        });
      } else if (command.includes('npm view')) {
        return Promise.resolve({ stdout: '2.0.0\n' });
      } else if (command.includes('npm install -g')) {
        return Promise.resolve({ stdout: '' });
      }
      return Promise.resolve({ stdout: '' });
    });

    await updateCommand();

    expect(consoleSpy).toHaveBeenCalledWith('🔄 Checking for updates...');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updating @agentage/cli from 1.0.0 to 2.0.0')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '✅ Successfully updated to version 2.0.0'
    );
  });

  it('handles npm view error', async () => {
    mockExecAsync.mockImplementation((command: string) => {
      if (command.includes('npm list')) {
        return Promise.resolve({
          stdout: JSON.stringify({
            dependencies: { '@agentage/cli': { version: '1.0.0' } },
          }),
        });
      } else if (command.includes('npm view')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ stdout: '' });
    });

    await expect(updateCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Update failed')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles npm install error', async () => {
    mockExecAsync.mockImplementation((command: string) => {
      if (command.includes('npm list')) {
        return Promise.resolve({
          stdout: JSON.stringify({
            dependencies: { '@agentage/cli': { version: '1.0.0' } },
          }),
        });
      } else if (command.includes('npm view')) {
        return Promise.resolve({ stdout: '2.0.0\n' });
      } else if (command.includes('npm install -g')) {
        return Promise.reject(new Error('Permission denied'));
      }
      return Promise.resolve({ stdout: '' });
    });

    await expect(updateCommand()).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Update failed')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles unknown installed version gracefully', async () => {
    let listCallCount = 0;
    mockExecAsync.mockImplementation((command: string) => {
      if (command.includes('npm list')) {
        listCallCount++;
        if (listCallCount === 1) {
          return Promise.reject(new Error('Not found'));
        }
        return Promise.resolve({
          stdout: JSON.stringify({
            dependencies: { '@agentage/cli': { version: '2.0.0' } },
          }),
        });
      } else if (command.includes('npm view')) {
        return Promise.resolve({ stdout: '2.0.0\n' });
      } else if (command.includes('npm install -g')) {
        return Promise.resolve({ stdout: '' });
      }
      return Promise.resolve({ stdout: '' });
    });

    await updateCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updating @agentage/cli from unknown to 2.0.0')
    );
  });
});
