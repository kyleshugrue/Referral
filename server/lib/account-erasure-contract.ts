export const ACCOUNT_ERASURE_MAX_ATTEMPTS = 5;
export const ACCOUNT_ERASURE_LEASE_MS = 10 * 60_000;
export const ACCOUNT_ERASURE_OPERATION_TIMEOUT_MS = 2 * 60_000;
export const ACCOUNT_ERASURE_SWEEP_INTERVAL_MS = 30_000;
export const ACCOUNT_ERASURE_BATCH_SIZE = 10;
export const ACCOUNT_ERASURE_RECOVERY_LIMIT = 100;

export type AccountErasureRetryClass = 'transient' | 'manual_review';
export type AccountErasureProviderStep = 'firebase' | 'media';

export function accountErasureRetryDelayMs(attemptCount: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attemptCount - 1), 60 * 60_000);
}