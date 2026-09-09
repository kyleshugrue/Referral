import { auth } from '../lib/firebase-admin';
import { logger } from '../lib/logger';
import { firebaseStorageService } from './firebase-storage';
import { storage, type IStorage } from '../storage';
import {
  ACCOUNT_ERASURE_BATCH_SIZE,
  ACCOUNT_ERASURE_OPERATION_TIMEOUT_MS,
  ACCOUNT_ERASURE_RECOVERY_LIMIT,
  type AccountErasureRetryClass,
} from '../lib/account-erasure-contract';

class AccountErasureTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out`);
    this.name = 'AccountErasureTimeoutError';
  }
}

type AccountErasureStorage = Pick<
  IStorage,
  | 'claimNextAccountErasureJob'
  | 'recoverExpiredAccountErasureJobs'
  | 'getUser'
  | 'destroyUserSessions'
  | 'markAccountErasureProviderStep'
  | 'completeAccountErasureJob'
  | 'failAccountErasureJob'
>;

async function withTimeout<T>(operation: string, task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new AccountErasureTimeoutError(operation)), ACCOUNT_ERASURE_OPERATION_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyFailure(error: unknown): { errorCode: string; retryClass: AccountErasureRetryClass } {
  const providerCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
  return {
    errorCode: providerCode || (error instanceof Error ? error.name : 'UnknownError'),
    retryClass: providerCode === 'auth/invalid-uid' ? 'manual_review' : 'transient',
  };
}

async function processOne(queueStorage: AccountErasureStorage): Promise<boolean> {
  const job = await queueStorage.claimNextAccountErasureJob();
  if (!job) return false;
  if (!job.claimToken) {
    logger.error('[AccountErasure] Claimed job did not include a claim token', { jobId: job.id });
    return true;
  }
  const claimToken = job.claimToken;
  try {
    const user = await queueStorage.getUser(job.userId);
    if (!user) {
      throw new Error('Account-erasure owner record is unavailable');
    }
    if (!job.firebaseDeletedAt) {
      try {
        if (user.firebaseUid) {
          await withTimeout('Firebase identity deletion', auth.deleteUser(user.firebaseUid));
        }
      } catch (error) {
        // Firebase reports an already-removed identity as a terminal success.
        if (!(error instanceof Error && 'code' in error && (error as { code?: string }).code === 'auth/user-not-found')) {
          throw error;
        }
      }
      if (!await queueStorage.markAccountErasureProviderStep(job.id, claimToken, 'firebase')) {
        logger.warn('[AccountErasure] Claim lost after Firebase deletion', { jobId: job.id });
        return false;
      }
    }
    if (!job.mediaDeletedAt) {
      await withTimeout(
        'Firebase media deletion',
        firebaseStorageService.deleteOwnedMediaForUser(job.userId, user.firebaseUid),
      );
      await withTimeout(
        'Legacy local media deletion',
        firebaseStorageService.deleteLegacyLocalMediaForUser([
          user.photo,
          user.resumeUrl,
          ...(user.resumePreviewUrls ?? []),
        ]),
      );
      if (!await queueStorage.markAccountErasureProviderStep(job.id, claimToken, 'media')) {
        logger.warn('[AccountErasure] Claim lost after media deletion', { jobId: job.id });
        return false;
      }
    }
    await withTimeout('server session deletion', queueStorage.destroyUserSessions(job.userId));
    const completed = await queueStorage.completeAccountErasureJob(job.id, job.userId, claimToken);
    if (!completed) {
      logger.warn('[AccountErasure] Claim lost before completion', { jobId: job.id });
    }
    return true;
  } catch (error) {
    const failure = classifyFailure(error);
    const outcome = await queueStorage.failAccountErasureJob(job.id, claimToken, failure.errorCode, failure.retryClass);
    logger.error('[AccountErasure] Job failed', {
      jobId: job.id,
      errorClass: failure.errorCode,
      retryClass: failure.retryClass,
      outcome,
    });
    return true;
  }
}

export async function processAccountErasureJobs(
  maxJobs = ACCOUNT_ERASURE_BATCH_SIZE,
  queueStorage: AccountErasureStorage = storage,
): Promise<void> {
  const recovered = await queueStorage.recoverExpiredAccountErasureJobs(ACCOUNT_ERASURE_RECOVERY_LIMIT);
  if (recovered > 0) {
    logger.info('[AccountErasure] Recovered expired leases', { recovered });
  }
  for (let i = 0; i < maxJobs; i++) {
    if (!await processOne(queueStorage)) return;
  }
}