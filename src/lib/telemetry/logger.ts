import { promises as fs } from 'fs';
import { join } from 'path';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// Log file configuration
const LOG_DIR = process.cwd();
const LOG_FILE = join(LOG_DIR, 'app.log');
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB max file size before rotation
const ROTATED_LOG_COUNT = 5; // Keep up to 5 rotated log files

// Ensure log directory exists
let logInitialized = false;
const initLogFile = async () => {
  if (logInitialized) return;
  
  try {
    // Check if log file exists and rotate if too large
    try {
      const stats = await fs.stat(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        // Rotate logs
        for (let i = ROTATED_LOG_COUNT - 1; i >= 1; i--) {
          const oldFile = `${LOG_FILE}.${i}`;
          const newFile = `${LOG_FILE}.${i + 1}`;
          try {
            await fs.rename(oldFile, newFile);
          } catch {
            // File doesn't exist, skip
          }
        }
        // Move current log to .1
        try {
          await fs.rename(LOG_FILE, `${LOG_FILE}.1`);
        } catch {
          // File doesn't exist or already rotated
        }
      }
    } catch {
      // Log file doesn't exist yet, create it
      await fs.writeFile(LOG_FILE, '', 'utf-8');
    }
    
    logInitialized = true;
  } catch (error) {
    // If file operations fail, continue without file logging
    console.warn('[Logger] Failed to initialize log file:', error instanceof Error ? error.message : String(error));
    logInitialized = true; // Set to true to prevent retrying
  }
};

// Write to log file (non-blocking)
const writeToFile = async (level: LogLevel, timestamp: string, payload: string) => {
  if (!logInitialized) {
    await initLogFile();
  }
  
  try {
    const logLine = `[${timestamp}] [Velou:${level.toUpperCase()}] ${payload}\n`;
    await fs.appendFile(LOG_FILE, logLine, 'utf-8');
  } catch (error) {
    // Silently fail file writes to avoid breaking the application
    // Only log if it's the first few failures
    if (Math.random() < 0.01) { // Log ~1% of failures to avoid spam
      console.error('[Logger] Failed to write to log file:', error instanceof Error ? error.message : String(error));
    }
  }
};

const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
  const payload = meta ? { message, ...meta } : { message };
  const timestamp = new Date().toISOString();
  const payloadString = JSON.stringify(payload);
  
  // Write to console (existing behavior)
  if (level === 'debug') {
    console.log(`[${timestamp}] [Velou:DEBUG]`, payload);
  } else {
    console[level](`[${timestamp}] [Velou:${level.toUpperCase()}]`, payload);
  }
  
  // Write to file asynchronously (non-blocking)
  // Use setImmediate to avoid blocking the event loop
  setImmediate(() => {
    writeToFile(level, timestamp, payloadString).catch(() => {
      // Silently handle errors to avoid breaking the app
    });
  });
};

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};

