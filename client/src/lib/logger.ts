import { sanitizeLogArgs } from '@shared/log-sanitizer';

const isDevelopment = import.meta.env.MODE !== 'production';

export const redactLogArgs = sanitizeLogArgs;

const formatLogArgs = (args: unknown[]): string =>
  sanitizeLogArgs(args)
    .map((value) => {
      try {
        return JSON.stringify(value) ?? '[undefined]';
      } catch {
        return '[unserializable]';
      }
    })
    .join(' ');

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log(formatLogArgs(args));
    }
  },
  info: (...args: unknown[]) => {
    console.log(formatLogArgs(args));
  },
  warn: (...args: unknown[]) => {
    console.warn(formatLogArgs(args));
  },
  error: (...args: unknown[]) => {
    console.error(formatLogArgs(args));
  }
};
