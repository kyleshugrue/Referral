import { describe, expect, it } from 'vitest';
import { parseServerEnvironment } from '../env';

const productionEnv = {
  NODE_ENV: 'production',
  PORT: '5000',
  ["DATABASE_URL"]: 'postgres://localhost:5432/referral',
  ["SESSION_SECRET"]: 's'.repeat(32),
  ["JWT_SECRET"]: 'j'.repeat(32),
  FIREBASE_PROJECT_ID: 'referral',
  FIREBASE_CLIENT_EMAIL: 'firebase@example.invalid',
  ["FIREBASE_PRIVATE_KEY"]: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
  RATE_LIMIT_MODE: 'single-instance',
  CI: 'false',
} as NodeJS.ProcessEnv;

describe('parseServerEnvironment', () => {
  it('parses bounded production settings without exposing secret values', () => {
    expect(parseServerEnvironment(productionEnv)).toMatchObject({
      nodeEnv: 'production',
      port: 5000,
      sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
      sessionSameSite: 'lax',
      rateLimitMode: 'single-instance',
      smokeTestEnabled: false,
    });
  });

  it('rejects weak production secrets and unsupported limiter topology', () => {
    expect(() => parseServerEnvironment({
      ...productionEnv,
       ["SESSION_SECRET"]: 'short',
    } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(() => parseServerEnvironment({
      ...productionEnv,
      RATE_LIMIT_MODE: 'memory',
    } as NodeJS.ProcessEnv)).toThrow(/RATE_LIMIT_MODE/);
    expect(parseServerEnvironment({
      ...productionEnv,
      RATE_LIMIT_MODE: 'postgres',
    } as NodeJS.ProcessEnv).rateLimitMode).toBe('postgres');
  });

  it('keeps the synthetic fixture unavailable outside CI', () => {
    expect(() => parseServerEnvironment({
      ...productionEnv,
      SMOKE_TEST: 'true',
      CI: 'false',
    } as NodeJS.ProcessEnv)).toThrow(/SMOKE_TEST/);
  });

  it('rejects malformed limits and origins', () => {
    expect(() => parseServerEnvironment({
      ...productionEnv,
      JSON_BODY_LIMIT_BYTES: 'not-a-number',
    } as NodeJS.ProcessEnv)).toThrow(/JSON_BODY_LIMIT_BYTES/);
    expect(() => parseServerEnvironment({
      ...productionEnv,
      ALLOWED_ORIGINS: 'https://example.com/private/path',
    } as NodeJS.ProcessEnv)).toThrow(/ALLOWED_ORIGINS/);
  });
});