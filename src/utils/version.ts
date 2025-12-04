import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const PACKAGE_NAME = '@agentage/cli';

export const getInstalledVersion = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync(`npm list -g ${PACKAGE_NAME} --json`);
    const data = JSON.parse(stdout);
    return data.dependencies?.[PACKAGE_NAME]?.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

export const getLatestVersion = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync(`npm view ${PACKAGE_NAME} version`);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
};

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export const checkForUpdates = async (
  currentVersion: string
): Promise<VersionCheckResult> => {
  const latestVersion = await getLatestVersion();
  const updateAvailable =
    latestVersion !== 'unknown' && latestVersion !== currentVersion;

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
  };
};
