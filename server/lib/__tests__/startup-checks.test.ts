import { describe, it, expect } from 'vitest';
import { assertRequiredEnv } from '../startup-checks';

const FULL_ENV = {
  DATABASE_URL: 'postgres://example',
  SESSION_SECRET: 'x',
  JWT_SECRET: 'y',
  INTERNAL_API_SECRET: 'z',
} as NodeJS.ProcessEnv;

describe('assertRequiredEnv', () => {
  it('passes when all required variables are present', () => {
    expect(() => assertRequiredEnv(true, FULL_ENV)).not.toThrow();
  });

  it('throws in production when a core secret is missing', () => {
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, JWT_SECRET: undefined } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, SESSION_SECRET: undefined } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(() => assertRequiredEnv(true, { ...FULL_ENV, DATABASE_URL: undefined } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('only warns (does not throw) outside production', () => {
    expect(() => assertRequiredEnv(false, {} as NodeJS.ProcessEnv)).not.toThrow();
  });
});
