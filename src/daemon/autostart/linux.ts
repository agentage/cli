import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutostartDeps, AutostartResult, PlatformModule } from './types.js';

export const UNIT_NAME = 'agentage.service';

export const unitDir = (homeDir: string): string => join(homeDir, '.config', 'systemd', 'user');

export const unitPath = (homeDir: string): string => join(unitDir(homeDir), UNIT_NAME);

export const renderUnit = (nodeBin: string, entryPath: string): string =>
  `[Unit]
Description=Agentage daemon
After=default.target

[Service]
Type=simple
ExecStart=${nodeBin} ${entryPath}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

export const linux: PlatformModule = {
  install(deps: AutostartDeps): AutostartResult {
    const path = unitPath(deps.homeDir);
    mkdirSync(unitDir(deps.homeDir), { recursive: true });
    writeFileSync(path, renderUnit(deps.nodeBin, deps.entryPath), 'utf-8');

    deps.exec('systemctl --user daemon-reload');
    deps.exec(`systemctl --user enable --now ${UNIT_NAME}`);

    let startsAtBoot = false;
    try {
      deps.exec('loginctl enable-linger');
      startsAtBoot = true;
    } catch {
      // Polkit may refuse; daemon will start at first login instead.
    }

    return { mechanism: 'systemd-user', unitPath: path, startsAtBoot };
  },

  uninstall(deps: AutostartDeps): void {
    try {
      deps.exec(`systemctl --user disable --now ${UNIT_NAME}`);
    } catch {
      // Unit may already be gone.
    }
    const path = unitPath(deps.homeDir);
    if (existsSync(path)) unlinkSync(path);
    try {
      deps.exec('systemctl --user daemon-reload');
    } catch {
      // Best-effort.
    }
  },

  isInstalled(deps: AutostartDeps): boolean {
    return existsSync(unitPath(deps.homeDir));
  },
};
