export interface AutostartDeps {
  homeDir: string;
  nodeBin: string;
  entryPath: string;
  exec: (cmd: string) => void;
}

export interface AutostartResult {
  /** systemd-user | launchd-agent | schtasks-onlogon */
  mechanism: 'systemd-user' | 'launchd-agent' | 'schtasks-onlogon';
  /** Path to the unit/plist/task — what to point the user at if they want to inspect */
  unitPath: string;
  /**
   * True only on Linux with linger enabled — daemon comes up before login.
   * macOS LaunchAgent and Windows ONLOGON fire at user login, not boot.
   */
  startsAtBoot: boolean;
}

export interface PlatformModule {
  install(deps: AutostartDeps): AutostartResult;
  uninstall(deps: AutostartDeps): void;
  isInstalled(deps: AutostartDeps): boolean;
}
