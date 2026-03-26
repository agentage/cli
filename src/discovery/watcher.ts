import { watch, existsSync, type FSWatcher } from 'node:fs';
import { logInfo, logWarn } from '../daemon/logger.js';

const DEBOUNCE_MS = 500;

const AGENT_FILE_PATTERNS = ['.agent.md', '.agent.ts', '.agent.js', 'agent.ts', 'agent.js'];

const isAgentFile = (filename: string | null): boolean => {
  if (!filename) return true; // Unknown filename — trigger rescan to be safe
  return AGENT_FILE_PATTERNS.some((p) => filename.endsWith(p));
};

export const startWatcher = (dirs: string[], onUpdate: () => void): (() => void) => {
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleUpdate = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      logInfo('[watcher] File change detected, triggering rescan');
      onUpdate();
    }, DEBOUNCE_MS);
  };

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      logWarn(`[watcher] Directory does not exist, skipping: ${dir}`);
      continue;
    }

    try {
      const watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (isAgentFile(filename as string | null)) {
          scheduleUpdate();
        }
      });

      watcher.on('error', (err) => {
        logWarn(`[watcher] Error watching ${dir}: ${err.message}`);
      });

      watchers.push(watcher);
      logInfo(`[watcher] Watching directory: ${dir}`);
    } catch (err) {
      logWarn(
        `[watcher] Failed to watch ${dir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const watcher of watchers) {
      watcher.close();
    }
    logInfo('[watcher] All watchers stopped');
  };
};
