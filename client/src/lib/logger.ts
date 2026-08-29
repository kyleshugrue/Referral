import { sanitizeLogArgs } from '@shared/log-sanitizer';

const isDevelopment = import.meta.env.MODE !== 'production';

export const redactLogArgs = sanitizeLogArgs;

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log(...sanitizeLogArgs(args));
    }
  },
  info: (...args: unknown[]) => {
    console.log(...sanitizeLogArgs(args));
  },
  warn: (...args: unknown[]) => {
    console.warn(...sanitizeLogArgs(args));
  },
  error: (...args: unknown[]) => {
    console.error(...sanitizeLogArgs(args));
  }
};
