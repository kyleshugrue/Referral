import { describe, it, expect } from 'vitest';
import { isOriginAllowed, getAllowedOrigins } from '../http-security';

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
