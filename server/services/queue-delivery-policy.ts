export type QueueDeliveryOutcome =
  | 'delivered'
  | 'retryable-failure'
  | 'permanent-failure'
  | 'expired';

export type QueueDeliveryStatus = 'pending' | 'completed' | 'failed';

export interface QueueDeliveryDecision {
  status: QueueDeliveryStatus;
  errorMessage?: string;
}

/**
 * Keep queue state transitions deterministic and shared by callback/push
 * processors. The attempt count passed here is the count after claiming.
 */
export function decideQueueDelivery(
  outcome: QueueDeliveryOutcome,
  attemptCount: number,
  maxAttempts: number,
): QueueDeliveryDecision {
  if (outcome === 'delivered') return { status: 'completed' };
  if (outcome === 'expired') {
    return { status: 'failed', errorMessage: 'Delivery obligation expired' };
  }
  if (outcome === 'permanent-failure' || attemptCount >= maxAttempts) {
    return {
      status: 'failed',
      errorMessage: outcome === 'permanent-failure'
        ? 'Permanent delivery failure'
        : 'Maximum delivery attempts reached',
    };
  }
  return { status: 'pending', errorMessage: 'Delivery will be retried' };
}

export function isLeaseExpired(
  lastAttemptAt: string | Date | null | undefined,
  staleBefore: string | Date,
): boolean {
  if (!lastAttemptAt) return true;
  return new Date(lastAttemptAt).getTime() < new Date(staleBefore).getTime();
}