import { auth } from '../lib/firebase-admin';
import { logger } from '../lib/logger';
import { firebaseStorageService } from './firebase-storage';
import { storage } from '../storage';

const MAX_ATTEMPTS = 5;

async function processOne(): Promise<boolean> {
  const job = await storage.claimNextAccountErasureJob();
  if (!job) return false;
  try {
    const user = await storage.getUserById(job.userId);
    if (!user) {
      await storage.completeAccountErasureJob(job.id, job.userId);
      return true;
    }
    if (user.firebaseUid) {
      try {
        await auth.deleteUser(user.firebaseUid);
      } catch (error) {
        // Firebase reports an already-removed identity as a terminal success.
        if (!(error instanceof Error && 'code' in error && (error as { code?: string }).code === 'auth/user-not-found')) {
          throw error;
        }
      }
    }
    await firebaseStorageService.deleteOwnedMediaForUser(job.userId, user.firebaseUid);
    await storage.completeAccountErasureJob(job.id, job.userId);
    return true;
  } catch (error) {
    const manualReview = job.attemptCount >= MAX_ATTEMPTS;
    await storage.failAccountErasureJob(
      job.id,
      error instanceof Error ? error.name : 'UnknownError',
      manualReview,
    );
    logger.error('[AccountErasure] Job failed', {
      jobId: job.id,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      manualReview,
    });
    return true;
  }
}

export async function processAccountErasureJobs(maxJobs = 10): Promise<void> {
  for (let i = 0; i < maxJobs; i++) {
    if (!await processOne()) return;
  }
}