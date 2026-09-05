import { describe, expect, it } from 'vitest';
import { isActiveAccount, isActiveAccountStatus } from '../account-status';

describe('account status authorization invariant', () => {
  it('allows only explicit active and legacy-absent values', () => {
    expect(isActiveAccountStatus('active')).toBe(true);
    expect(isActiveAccountStatus(undefined)).toBe(true);
    expect(isActiveAccountStatus(null)).toBe(true);
    expect(isActiveAccountStatus('deletion_pending')).toBe(false);
    expect(isActiveAccountStatus('erased')).toBe(false);
    expect(isActiveAccountStatus('')).toBe(false);
  });

  it('fails closed for missing or inactive users', () => {
    expect(isActiveAccount(undefined)).toBe(false);
    expect(isActiveAccount({ accountStatus: 'deletion_pending' })).toBe(false);
    expect(isActiveAccount({ accountStatus: 'active' })).toBe(true);
  });
});