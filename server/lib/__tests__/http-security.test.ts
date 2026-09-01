import { describe, it, expect } from 'vitest';
import { isOriginAllowed, getAllowedOrigins, securityHeaders } from '../http-security';

const PROD = true;
const DEV = false;

describe('isOriginAllowed (production)', () => {
  it('allows requests without an Origin header', () => {
    expect(isOriginAllowed(undefined, PROD)).toBe(true);
  });

  it('allows the Capacitor/Ionic WebView origins', () => {
    expect(isOriginAllowed('capacitor://localhost', PROD)).toBe(true);
    expect(isOriginAllowed('ionic://localhost', PROD)).toBe(true);
  });

  it('allows the production web domains', () => {
    expect(isOriginAllowed('https://referralprofessional.net', PROD)).toBe(true);
    expect(isOriginAllowed('https://www.referralprofessional.net', PROD)).toBe(true);
    expect(isOriginAllowed('https://referral-mobile-app-kylejshugrue.replit.app', PROD)).toBe(true);
  });

  it('blocks arbitrary origins in production', () => {
    expect(isOriginAllowed('https://evil.example.com', PROD)).toBe(false);
    expect(isOriginAllowed('http://localhost:5173', PROD)).toBe(false);
    expect(isOriginAllowed('https://foo.replit.dev', PROD)).toBe(false);
  });

  it('blocks lookalike domains (substring attacks)', () => {
    expect(isOriginAllowed('https://referralprofessional.net.evil.com', PROD)).toBe(false);
    expect(isOriginAllowed('https://evilreferralprofessional.net', PROD)).toBe(false);
  });

  it('honors extra origins from ALLOWED_ORIGINS env', () => {
    const origins = getAllowedOrigins({ ALLOWED_ORIGINS: 'https://staging.example.com, https://beta.example.com' } as NodeJS.ProcessEnv);
    expect(isOriginAllowed('https://staging.example.com', PROD, origins)).toBe(true);
    expect(isOriginAllowed('https://beta.example.com', PROD, origins)).toBe(true);
    expect(isOriginAllowed('https://other.example.com', PROD, origins)).toBe(false);
  });
});

describe('isOriginAllowed (development)', () => {
  it('additionally allows localhost and Replit preview origins', () => {
    expect(isOriginAllowed('http://localhost:5173', DEV)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5000', DEV)).toBe(true);
    expect(isOriginAllowed('https://something.janeway.replit.dev', DEV)).toBe(true);
  });

  it('still blocks arbitrary origins in development', () => {
    expect(isOriginAllowed('https://evil.example.com', DEV)).toBe(false);
    expect(isOriginAllowed('https://replit.dev.evil.com', DEV)).toBe(false);
    expect(isOriginAllowed('not-a-url', DEV)).toBe(false);
  });
});

describe('securityHeaders', () => {
  function responseHeaders() {
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    };
    return { headers, response };
  }

  it('sets baseline headers in development without breaking preview framing', () => {
    const { headers, response } = responseHeaders();
    securityHeaders(false)({} as never, response as never, (() => {}) as never);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.has('Content-Security-Policy')).toBe(false);
  });

  it('sets a restrictive production policy without unsafe-eval', () => {
    const { headers, response } = responseHeaders();
    securityHeaders(true)({} as never, response as never, (() => {}) as never);
    const csp = headers.get('Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).toContain('https://maps.googleapis.com');
    expect(csp).toContain('https://www.google-analytics.com');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=');
  });
});
