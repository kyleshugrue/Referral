import { describe, it, expect } from 'vitest';
import { decideConnectionRequestCreation } from '../connection-policy';

describe('decideConnectionRequestCreation (connections/referral operation)', () => {
  it('allows creating a request when none exists yet between the two users', () => {
    expect(decideConnectionRequestCreation(0)).toEqual({ allowed: true });
  });

  it('blocks creating a duplicate request when one already exists', () => {
    expect(decideConnectionRequestCreation(1)).toEqual({
      allowed: false,
      reason: 'Connection request already exists',
    });
  });

  it('blocks regardless of how many existing requests are found', () => {
    expect(decideConnectionRequestCreation(3).allowed).toBe(false);
  });
});
