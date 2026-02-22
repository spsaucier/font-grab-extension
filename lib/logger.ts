/**
 * Shared logging utility for Font Grab extension
 * Supports log levels: DEBUG, INFO, WARN, ERROR
 * Respects production mode and chrome.storage debug flag
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MAX_ERROR_LOG_ENTRIES = 50;

class Logger {
  private debugMode: boolean = false;
  private isProduction: boolean = import.meta.env.MODE === 'production';
  private errorLog: LogEntry[] = [];
  private initialized: boolean = false;

  constructor() {
    this.initializeDebugMode();
  }

  /**
   * Initialize debug mode from chrome.storage
   * Falls back to false if storage is unavailable (e.g., content script context)
   */
  private initializeDebugMode(): void {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get('debugMode', (result) => {
        this.debugMode = result.debugMode === true;
        this.initialized = true;
      });
    } else {
      this.initialized = true;
    }
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    // In production, suppress DEBUG logs
    if (this.isProduction && level === 'DEBUG') {
      return false;
    }

    // If debug mode is off, only show INFO and above
    if (!this.debugMode && level === 'DEBUG') {
      return false;
    }

    return true;
  }

  /**
   * Format log entry with timestamp
   */
  private formatEntry(level: LogLevel, message: string, data?: unknown): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
  }

  /**
   * Store error in chrome.storage for later inspection
   */
  private storeError(entry: LogEntry): void {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    chrome.storage.local.get('errorLog', (result) => {
      const errorLog: LogEntry[] = result.errorLog || [];
      errorLog.push(entry);

      // Keep only the last MAX_ERROR_LOG_ENTRIES
      if (errorLog.length > MAX_ERROR_LOG_ENTRIES) {
        errorLog.splice(0, errorLog.length - MAX_ERROR_LOG_ENTRIES);
      }

      chrome.storage.local.set({ errorLog });
    });
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.formatEntry(level, message, data);

    // Store errors in chrome.storage
    if (level === 'ERROR') {
      this.storeError(entry);
    }

    // Output to console (safe in all contexts)
    const consoleMethod = this.getConsoleMethod(level);
    if (data !== undefined) {
      consoleMethod(`[${entry.timestamp}] [${level}] ${message}`, data);
    } else {
      consoleMethod(`[${entry.timestamp}] [${level}] ${message}`);
    }
  }

  /**
   * Get appropriate console method for log level
   */
  private getConsoleMethod(level: LogLevel): typeof console.log {
    switch (level) {
      case 'DEBUG':
        return console.debug;
      case 'INFO':
        return console.info;
      case 'WARN':
        return console.warn;
      case 'ERROR':
        return console.error;
      default:
        return console.log;
    }
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, data?: unknown): void {
    this.log('DEBUG', message, data);
  }

  /**
   * Log at INFO level
   */
  info(message: string, data?: unknown): void {
    this.log('INFO', message, data);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, data?: unknown): void {
    this.log('WARN', message, data);
  }

  /**
   * Log at ERROR level
   */
  error(message: string, data?: unknown): void {
    this.log('ERROR', message, data);
  }

  /**
   * Set debug mode (for testing or runtime changes)
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ debugMode: enabled });
    }
  }

  /**
   * Get current debug mode status
   */
  getDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Clear error log from storage
   */
  clearErrorLog(): void {
    this.errorLog = [];
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ errorLog: [] });
    }
  }
}

// Export singleton instance
export const logger = new Logger();
