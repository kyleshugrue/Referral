import { describe, expect, it, vi } from 'vitest';
import type { MediaDeletionJob } from '@shared/schema';

const provider = vi.hoisted(() => ({
  deleteMediaReference: vi.fn(),
  deleteLegacyLocalMediaForUser: vi.fn(),
}));

vi.mock('./firebase-storage', () => ({
  firebaseStorageService: {
    deleteMediaReference: provider.deleteMediaReference,
    deleteLegacyLocalMediaForUser: provider.deleteLegacyLocalMediaForUser,
  },
}));

import { processMediaDeletionJobs } from './media-deletion';

function makeJob(id: number, reference: string): MediaDeletionJob {
  return {
    id,
    userId: 7,
    mediaReference: reference,
    purpose: reference.startsWith('/uploads/') ? 'photo' : 'resume',
    dedupeKey: `dedupe-${id}`,
    status: 'processing',
    attemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: new Date().toISOString(),
    lastErrorCode: null,
    lastErrorClass: null,
    lastErrorAt: null,
    requestedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    claimToken: `claim-${id}`,
    completedAt: null,
  };
}

function makeStorage(jobs: MediaDeletionJob[]) {
  return {
    recoverExpiredMediaDeletionJobs: vi.fn().mockResolvedValue(0),
    claimNextMediaDeletionJob: vi.fn(async () => jobs.shift()),
    completeMediaDeletionJob: vi.fn().mockResolvedValue(true),
    failMediaDeletionJob: vi.fn().mockResolvedValue('retrying'),
  };
}

describe('ordinary media deletion recovery worker', () => {
  it('drains managed and legacy deletion intents', async () => {
    provider.deleteMediaReference.mockReset().mockResolvedValue(undefined);
    provider.deleteLegacyLocalMediaForUser.mockReset().mockResolvedValue(undefined);
    const queueStorage = makeStorage([
      makeJob(1, '/api/media/opaque-resume'),
      makeJob(2, '/uploads/user-7-photo.jpg'),
    ]);

    await processMediaDeletionJobs(10, queueStorage as never);

    expect(provider.deleteMediaReference).toHaveBeenCalledWith('/api/media/opaque-resume');
    expect(provider.deleteLegacyLocalMediaForUser).toHaveBeenCalledWith(['/uploads/user-7-photo.jpg']);
    expect(queueStorage.completeMediaDeletionJob).toHaveBeenCalledTimes(2);
    expect(queueStorage.failMediaDeletionJob).not.toHaveBeenCalled();
  });

  it('keeps provider failures retryable and does not report completion', async () => {
    provider.deleteMediaReference.mockReset().mockRejectedValue(new Error('provider unavailable'));
    const queueStorage = makeStorage([makeJob(3, '/api/media/opaque-photo')]);

    await processMediaDeletionJobs(1, queueStorage as never);

    expect(queueStorage.completeMediaDeletionJob).not.toHaveBeenCalled();
    expect(queueStorage.failMediaDeletionJob).toHaveBeenCalledWith(
      3,
      'claim-3',
      'Error',
      'transient',
    );
  });

  it('recovers expired leases before claiming new work', async () => {
    provider.deleteMediaReference.mockReset().mockResolvedValue(undefined);
    const queueStorage = makeStorage([makeJob(4, '/api/media/opaque-photo')]);

    await processMediaDeletionJobs(1, queueStorage as never);

    expect(queueStorage.recoverExpiredMediaDeletionJobs).toHaveBeenCalledWith(100);
  });
});