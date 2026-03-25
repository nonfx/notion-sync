/**
 * Simple logger utility with log levels
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  const prefix = level.toUpperCase().padEnd(5);
  return `[${timestamp}] ${prefix} ${message}`;
}

export const log = {
  debug(message: string): void {
    if (shouldLog("debug")) {
      console.log(formatMessage("debug", message));
    }
  },

  info(message: string): void {
    if (shouldLog("info")) {
      console.log(formatMessage("info", message));
    }
  },

  warn(message: string): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message));
    }
  },

  error(message: string): void {
    if (shouldLog("error")) {
      console.error(formatMessage("error", message));
    }
  },
};
