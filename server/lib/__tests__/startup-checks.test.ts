import { describe, it, expect } from 'vitest';
import { assertRequiredEnv } from '../startup-checks';

const FULL_ENV = {
  DATABASE_URL: 'postgres://example',
  SESSION_SECRET: 'x',
  JWT_SECRET: 'y',
  INTERNAL_API_SECRET: 'z',
  FIREBASE_PROJECT_ID: 'firebase-project',
  FIREBASE_CLIENT_EMAIL: 'firebase@example.invalid',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nYourPrivateKeyHere\n-----END PRIVATE KEY-----',
} as NodeJS.ProcessEnv;
const malformedPrivateKey = 'not-a-private-key';

describe('assertRequiredEnv', () => {
  it('passes when all required variables are present', () => {
    expect(() => assertRequiredEnv(true, FULL_ENV)).not.toThrow();
  });

  it('throws in production when a core secret is missing', () => {
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, JWT_SECRET: undefined } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, SESSION_SECRET: undefined } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, DATABASE_URL: undefined } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('requires Firebase Admin credentials in production', () => {
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, FIREBASE_PROJECT_ID: undefined } as NodeJS.ProcessEnv)).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, FIREBASE_CLIENT_EMAIL: undefined } as NodeJS.ProcessEnv)).toThrow(/FIREBASE_CLIENT_EMAIL/);
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, FIREBASE_PRIVATE_KEY: undefined } as NodeJS.ProcessEnv)).toThrow(/FIREBASE_PRIVATE_KEY/);
  });

  it('rejects malformed Firebase private keys in production', () => {
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, FIREBASE_PRIVATE_KEY: malformedPrivateKey } as NodeJS.ProcessEnv))
      .toThrow(/FIREBASE_PRIVATE_KEY.*invalid format/);
  });

  it('only warns (does not throw) outside production', () => {
    expect(() => assertRequiredEnv(false, {} as NodeJS.ProcessEnv)).not.toThrow();
  });
});
