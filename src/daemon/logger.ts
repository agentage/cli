import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let currentLevel: LogLevel = 'info';

export const setLogLevel = (level: LogLevel): void => {
  currentLevel = level;
};

export const getLogLevel = (): LogLevel => currentLevel;

const getLogPath = (): string => join(getConfigDir(), 'daemon.log');

const rotateIfNeeded = (logPath: string): void => {
  if (!existsSync(logPath)) return;

  const stats = statSync(logPath);
  if (stats.size >= MAX_LOG_SIZE) {
    const rotatedPath = logPath + '.1';
    renameSync(logPath, rotatedPath);
  }
};

const formatMessage = (level: LogLevel, message: string): string => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
};

export const log = (level: LogLevel, message: string): void => {
  if (LOG_LEVELS[level] > LOG_LEVELS[currentLevel]) return;

  const logPath = getLogPath();
  rotateIfNeeded(logPath);
  appendFileSync(logPath, formatMessage(level, message), 'utf-8');
};

export const logError = (message: string): void => log('error', message);
export const logWarn = (message: string): void => log('warn', message);
export const logInfo = (message: string): void => log('info', message);
export const logDebug = (message: string): void => log('debug', message);
