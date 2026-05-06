import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutostartDeps, AutostartResult, PlatformModule } from './types.js';

export const LABEL = 'io.agentage.daemon';

export const plistDir = (homeDir: string): string => join(homeDir, 'Library', 'LaunchAgents');

export const plistPath = (homeDir: string): string => join(plistDir(homeDir), `${LABEL}.plist`);

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const renderPlist = (nodeBin: string, entryPath: string, homeDir: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodeBin)}</string>
    <string>${xmlEscape(entryPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(homeDir, '.agentage', 'logs', 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(homeDir, '.agentage', 'logs', 'launchd.err.log'))}</string>
</dict>
</plist>
`;

export const darwin: PlatformModule = {
  install(deps: AutostartDeps): AutostartResult {
    const path = plistPath(deps.homeDir);
    mkdirSync(plistDir(deps.homeDir), { recursive: true });
    mkdirSync(join(deps.homeDir, '.agentage', 'logs'), { recursive: true });
    writeFileSync(path, renderPlist(deps.nodeBin, deps.entryPath, deps.homeDir), 'utf-8');

    // launchctl bootstrap fails if the agent is already loaded; bootout first if so.
    try {
      deps.exec(`launchctl bootout gui/$(id -u)/${LABEL}`);
    } catch {
      // Not loaded — fine.
    }
    deps.exec(`launchctl bootstrap gui/$(id -u) "${path}"`);

    return { mechanism: 'launchd-agent', unitPath: path, startsAtBoot: false };
  },

  uninstall(deps: AutostartDeps): void {
    try {
      deps.exec(`launchctl bootout gui/$(id -u)/${LABEL}`);
    } catch {
      // Already gone.
    }
    const path = plistPath(deps.homeDir);
    if (existsSync(path)) unlinkSync(path);
  },

  isInstalled(deps: AutostartDeps): boolean {
    return existsSync(plistPath(deps.homeDir));
  },
};
