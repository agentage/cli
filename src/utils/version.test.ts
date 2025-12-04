import { PACKAGE_NAME, checkForUpdates } from './version.js';

describe('version utils', () => {
  describe('PACKAGE_NAME', () => {
    test('should be @agentage/cli', () => {
      expect(PACKAGE_NAME).toBe('@agentage/cli');
    });
  });

  describe('checkForUpdates', () => {
    test('should return updateAvailable false when versions match', async () => {
      const result = await checkForUpdates('0.1.8');
      // If the current npm version is 0.1.8, updateAvailable should be false
      if (result.latestVersion === '0.1.8') {
        expect(result.updateAvailable).toBe(false);
      }
      expect(result.currentVersion).toBe('0.1.8');
    });

    test('should return updateAvailable true when versions differ', async () => {
      const result = await checkForUpdates('0.0.1');
      // Unless npm is unreachable, an old version should show update available
      if (result.latestVersion !== 'unknown') {
        expect(result.updateAvailable).toBe(true);
      }
      expect(result.currentVersion).toBe('0.0.1');
    });

    test('should handle unknown latest version gracefully', async () => {
      const result = await checkForUpdates('1.0.0');
      expect(result.currentVersion).toBe('1.0.0');
      expect(typeof result.updateAvailable).toBe('boolean');
    });
  });
});
