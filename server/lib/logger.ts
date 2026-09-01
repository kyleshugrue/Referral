import { sanitizeLogArgs } from '@shared/log-sanitizer';

const isDevelopment = process.env.NODE_ENV !== 'production';
const consoleGuardKey = Symbol.for('referral.sanitized-console-guard');
const nativeConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

type GuardedGlobal = typeof globalThis & {
  [key: symbol]: boolean | undefined;
};

// A few legacy server modules still call console directly. Install one
// process-wide boundary so those calls receive the same redaction guarantees
// as the structured logger until each call site can be retired safely.
if (!(globalThis as GuardedGlobal)[consoleGuardKey]) {
  Object.defineProperty(globalThis, consoleGuardKey, { value: true, enumerable: false });
  for (const method of Object.keys(nativeConsole) as Array<keyof typeof nativeConsole>) {
    console[method] = (...args: unknown[]) => nativeConsole[method](...sanitizeLogArgs(args));
  }
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      nativeConsole.log(...sanitizeLogArgs(args));
    }
  },
  info: (...args: unknown[]) => {
    nativeConsole.info(...sanitizeLogArgs(args));
  },
  warn: (...args: unknown[]) => {
    nativeConsole.warn(...sanitizeLogArgs(args));
  },
  error: (...args: unknown[]) => {
    nativeConsole.error(...sanitizeLogArgs(args));
  }
};
