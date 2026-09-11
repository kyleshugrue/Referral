export const MEDIA_DELETION_MAX_ATTEMPTS = 5;
export const MEDIA_DELETION_LEASE_MS = 10 * 60_000;
export const MEDIA_DELETION_OPERATION_TIMEOUT_MS = 2 * 60_000;
export const MEDIA_DELETION_SWEEP_INTERVAL_MS = 30_000;
export const MEDIA_DELETION_BATCH_SIZE = 25;
export const MEDIA_DELETION_RECOVERY_LIMIT = 100;

export type MediaDeletionRetryClass = 'transient' | 'manual_review';

export function mediaDeletionRetryDelayMs(attemptCount: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attemptCount - 1), 60 * 60_000);
}