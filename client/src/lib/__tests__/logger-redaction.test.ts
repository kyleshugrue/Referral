// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * client/src/lib/logger.ts computes `isDevelopment` once, at module load,
 * from `import.meta.env.MODE`. To exercise both branches we stub the env
 * var and force a fresh module instance via `vi.resetModules()` before each
 * dynamic import.
 */
async function loadLoggerWithMode(mode: 'development' | 'production') {
  vi.stubEnv('MODE', mode);
  vi.resetModules();
  return import('../logger');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('redaction helper strips sensitive fields before logging', () => {
  it('logger.error redacts a password field before it reaches console.error', async () => {
    const { logger } = await loadLoggerWithMode('development');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('Login failed', { email: 'user@example.com', password: 'hunter2' });

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('user@example.com');
  });

  it('logger.warn redacts sensitive fields the same way', async () => {
    const { logger } = await loadLoggerWithMode('development');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logger.warn('Token refresh issue', { token: 'abc.def.ghi' });

    const serialized = JSON.stringify(spy.mock.calls[0]);
    expect(serialized).not.toContain('abc.def.ghi');
  });
});

describe('production-mode logging omits debug output entirely', () => {
  it('logger.debug calls console.log in development mode', async () => {
    const { logger } = await loadLoggerWithMode('development');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.debug('Verbose diagnostic info', { userId: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('logger.debug does NOT call console.log at all in production mode', async () => {
    const { logger } = await loadLoggerWithMode('production');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.debug('Verbose diagnostic info', { email: 'user@example.com', password: 'hunter2' });

    expect(spy).not.toHaveBeenCalled();
  });

  it('logger.error/warn still emit (and still redact) in production mode', async () => {
    const { logger } = await loadLoggerWithMode('production');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('Critical failure', { password: 'hunter2' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('hunter2');
  });
});
