import { describe, expect, it } from 'vitest';
import { decideQueueDelivery, isLeaseExpired } from './queue-delivery-policy';

describe('queue delivery policy', () => {
  it('completes a WebSocket or push success without retrying', () => {
    expect(decideQueueDelivery('delivered', 1, 3)).toEqual({ status: 'completed' });
  });

  it('returns transient failures to pending for backoff-based retry', () => {
    expect(decideQueueDelivery('retryable-failure', 1, 3)).toEqual({
      status: 'pending',
      errorMessage: 'Delivery will be retried',
    });
  });

  it('dead-letters terminal provider failures', () => {
    expect(decideQueueDelivery('permanent-failure', 1, 3)).toEqual({
      status: 'failed',
      errorMessage: 'Permanent delivery failure',
    });
  });

  it('dead-letters after the maximum attempt even when a failure is retryable', () => {
    expect(decideQueueDelivery('retryable-failure', 3, 3)).toEqual({
      status: 'failed',
      errorMessage: 'Maximum delivery attempts reached',
    });
  });

  it('treats expired obligations as terminal', () => {
    expect(decideQueueDelivery('expired', 1, 3)).toEqual({
      status: 'failed',
      errorMessage: 'Delivery obligation expired',
    });
  });

  it('recovers missing and expired leases but preserves active ones', () => {
    const staleBefore = '2026-09-01T12:00:00.000Z';
    expect(isLeaseExpired(null, staleBefore)).toBe(true);
    expect(isLeaseExpired('2026-09-01T11:59:59.000Z', staleBefore)).toBe(true);
    expect(isLeaseExpired('2026-09-01T12:00:01.000Z', staleBefore)).toBe(false);
  });
});