import { describe, expect, it } from 'vitest';
import { pseudonymousRateLimitKey } from '../postgres-rate-limit-store';

describe('PostgreSQL rate-limit key derivation', () => {
  it('is stable for the same scope/value and does not expose the source value', () => {
    const first = pseudonymousRateLimitKey('ip', '203.0.113.9', 'unit-test-secret');
    const second = pseudonymousRateLimitKey('ip', '203.0.113.9', 'unit-test-secret');

    expect(first).toBe(second);
    expect(first).toMatch(/^ip:[a-f0-9]{64}$/);
    expect(first).not.toContain('203.0.113.9');
  });

  it('changes when the secret or logical scope changes', () => {
    const original = pseudonymousRateLimitKey('ip', '203.0.113.9', 'unit-test-secret');

    expect(pseudonymousRateLimitKey('ip', '203.0.113.9', 'another-test-secret')).not.toBe(original);
    expect(pseudonymousRateLimitKey('auth', '203.0.113.9', 'unit-test-secret')).not.toBe(original);
  });
});