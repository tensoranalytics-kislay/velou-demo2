type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
  const payload = meta ? { message, ...meta } : { message };
  const timestamp = new Date().toISOString();
  // Use console.log for debug to ensure visibility (console.debug may be filtered)
  if (level === 'debug') {
    console.log(`[${timestamp}] [Velou:DEBUG]`, payload);
  } else {
    console[level](`[${timestamp}] [Velou:${level.toUpperCase()}]`, payload);
  }
};

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};

