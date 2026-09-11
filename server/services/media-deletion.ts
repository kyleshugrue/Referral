import { logger } from '../lib/logger';
import {
  MEDIA_DELETION_BATCH_SIZE,
  MEDIA_DELETION_OPERATION_TIMEOUT_MS,
  MEDIA_DELETION_RECOVERY_LIMIT,
  type MediaDeletionRetryClass,
} from '../lib/media-deletion-contract';
import { firebaseStorageService } from './firebase-storage';
import { storage, type IStorage } from '../storage';

class MediaDeletionTimeoutError extends Error {
  constructor() {
    super('Media provider deletion timed out');
    this.name = 'MediaDeletionTimeoutError';
  }
}

type MediaDeletionStorage = Pick<
  IStorage,
  | 'claimNextMediaDeletionJob'
  | 'recoverExpiredMediaDeletionJobs'
  | 'completeMediaDeletionJob'
  | 'failMediaDeletionJob'
>;

async function withTimeout<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new MediaDeletionTimeoutError()), MEDIA_DELETION_OPERATION_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyFailure(error: unknown): { errorCode: string; retryClass: MediaDeletionRetryClass } {
  const providerCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
  return {
    errorCode: providerCode || (error instanceof Error ? error.name : 'UnknownError'),
    retryClass: 'transient',
  };
}

async function processOne(queueStorage: MediaDeletionStorage): Promise<boolean> {
  const job = await queueStorage.claimNextMediaDeletionJob();
  if (!job) return false;
  if (!job.claimToken) {
    logger.error('[MediaDeletion] Claimed job did not include a claim token', { jobId: job.id });
    return true;
  }

  try {
    if (job.mediaReference.startsWith('/api/media/')) {
      await withTimeout(firebaseStorageService.deleteMediaReference(job.mediaReference));
    } else if (job.mediaReference.startsWith('/uploads/')) {
      await withTimeout(firebaseStorageService.deleteLegacyLocalMediaForUser([job.mediaReference]));
    } else {
      throw new Error('Unsupported media reference');
    }

    if (!await queueStorage.completeMediaDeletionJob(job.id, job.claimToken)) {
      logger.warn('[MediaDeletion] Claim lost before completion', { jobId: job.id });
    }
  } catch (error) {
    const failure = classifyFailure(error);
    const outcome = await queueStorage.failMediaDeletionJob(
      job.id,
      job.claimToken,
      failure.errorCode,
      failure.retryClass,
    );
    logger.error('[MediaDeletion] Job failed', {
      jobId: job.id,
      errorClass: failure.errorCode,
      retryClass: failure.retryClass,
      outcome,
    });
  }
  return true;
}

export async function processMediaDeletionJobs(
  maxJobs = MEDIA_DELETION_BATCH_SIZE,
  queueStorage: MediaDeletionStorage = storage,
): Promise<void> {
  const recovered = await queueStorage.recoverExpiredMediaDeletionJobs(MEDIA_DELETION_RECOVERY_LIMIT);
  if (recovered > 0) {
    logger.info('[MediaDeletion] Recovered expired leases', { recovered });
  }
  for (let i = 0; i < maxJobs; i += 1) {
    if (!await processOne(queueStorage)) return;
  }
}