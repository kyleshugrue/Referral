import { describe, it, expect, afterEach } from 'vitest';
import { isSpaRoute, isNoIndexRoute } from '../spa-routes';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

const DEBUG_ROUTES = [
  '/auth-preview',
  '/group-chat-debug',
  '/keyboard-test',
  '/device-test',
  '/synergy-button-demo',
];

describe('debug routes are unreachable in production (regression)', () => {
  it('are recognized as SPA routes outside production', () => {
    process.env.NODE_ENV = 'development';
    for (const route of DEBUG_ROUTES) {
      expect(isSpaRoute(route)).toBe(true);
    }
  });

  it('resolve to false (i.e. a real 404, not a soft-404 200) once NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    for (const route of DEBUG_ROUTES) {
      expect(isSpaRoute(route)).toBe(false);
    }
  });

  it('are not reported as no-index-worthy debug routes in production either (they simply do not exist)', () => {
    process.env.NODE_ENV = 'production';
    // isNoIndexRoute only special-cases debug routes while debug routes are
    // enabled; in production they fall through to the real-route patterns,
    // none of which match these paths.
    for (const route of DEBUG_ROUTES) {
      expect(isNoIndexRoute(route)).toBe(false);
    }
  });
});

describe('real SPA routes remain reachable regardless of NODE_ENV', () => {
  it('always resolves the root and auth routes', () => {
    process.env.NODE_ENV = 'production';
    expect(isSpaRoute('/')).toBe(true);
    expect(isSpaRoute('/auth')).toBe(true);
    expect(isSpaRoute('/verify-email')).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(isSpaRoute('/')).toBe(true);
    expect(isSpaRoute('/auth')).toBe(true);
  });

  it('flags authenticated app routes as no-index in every environment', () => {
    for (const env of ['production', 'development']) {
      process.env.NODE_ENV = env;
      expect(isNoIndexRoute('/profile')).toBe(true);
      expect(isNoIndexRoute('/connections')).toBe(true);
    }
  });
});
