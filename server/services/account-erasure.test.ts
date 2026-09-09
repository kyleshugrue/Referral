import { describe, expect, it, vi } from 'vitest';
import type { AccountErasureJob, User } from '@shared/schema';

const provider = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  deleteOwnedMediaForUser: vi.fn(),
  deleteLegacyLocalMediaForUser: vi.fn(),
}));

vi.mock('../lib/firebase-admin', () => ({
  auth: { deleteUser: provider.deleteUser },
}));

vi.mock('./firebase-storage', () => ({
  firebaseStorageService: {
    deleteOwnedMediaForUser: provider.deleteOwnedMediaForUser,
    deleteLegacyLocalMediaForUser: provider.deleteLegacyLocalMediaForUser,
  },
}));

import { processAccountErasureJobs } from './account-erasure';

function makeJob(id: number, overrides: Partial<AccountErasureJob> = {}): AccountErasureJob {
  return {
    id,
    userId: id,
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
    firebaseDeletedAt: null,
    mediaDeletedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeUser(id: number, firebaseUid: string | null = null): User {
  return { id, firebaseUid } as User;
}

function makeStorage(jobs: AccountErasureJob[]) {
  const storage = {
    recoverExpiredAccountErasureJobs: vi.fn().mockResolvedValue(0),
    claimNextAccountErasureJob: vi.fn(async () => jobs.shift()),
    getUser: vi.fn(async (userId: number) => makeUser(userId)),
    destroyUserSessions: vi.fn().mockResolvedValue(undefined),
    markAccountErasureProviderStep: vi.fn().mockResolvedValue(true),
    completeAccountErasureJob: vi.fn().mockResolvedValue(true),
    failAccountErasureJob: vi.fn().mockResolvedValue('retrying'),
  };
  return storage;
}

describe('account erasure recovery worker', () => {
  it('drains work across bounded sweeps instead of relying on one startup batch', async () => {
    provider.deleteUser.mockReset();
    provider.deleteOwnedMediaForUser.mockReset().mockResolvedValue(undefined);
    provider.deleteLegacyLocalMediaForUser.mockReset().mockResolvedValue(undefined);
    const jobs = Array.from({ length: 21 }, (_, index) => makeJob(index + 1));
    const queueStorage = makeStorage(jobs);

    await processAccountErasureJobs(10, queueStorage as never);
    await processAccountErasureJobs(10, queueStorage as never);
    await processAccountErasureJobs(10, queueStorage as never);

    expect(queueStorage.recoverExpiredAccountErasureJobs).toHaveBeenCalledTimes(3);
    expect(queueStorage.completeAccountErasureJob).toHaveBeenCalledTimes(21);
    expect(provider.deleteOwnedMediaForUser).toHaveBeenCalledTimes(21);
    expect(provider.deleteLegacyLocalMediaForUser).toHaveBeenCalledTimes(21);
    expect(queueStorage.destroyUserSessions).toHaveBeenCalledTimes(21);
  });

  it('does not let a stale claimant complete after a provider operation', async () => {
    provider.deleteOwnedMediaForUser.mockReset().mockResolvedValue(undefined);
    provider.deleteLegacyLocalMediaForUser.mockReset().mockResolvedValue(undefined);
    const queueStorage = makeStorage([makeJob(7)]);
    queueStorage.markAccountErasureProviderStep.mockResolvedValue(false);

    await processAccountErasureJobs(1, queueStorage as never);

    expect(queueStorage.completeAccountErasureJob).not.toHaveBeenCalled();
    expect(queueStorage.failAccountErasureJob).not.toHaveBeenCalled();
  });

  it('treats an already-removed Firebase identity as idempotent success', async () => {
    provider.deleteUser.mockReset().mockRejectedValue(Object.assign(new Error('missing'), { code: 'auth/user-not-found' }));
    provider.deleteOwnedMediaForUser.mockReset().mockResolvedValue(undefined);
    provider.deleteLegacyLocalMediaForUser.mockReset().mockResolvedValue(undefined);
    const queueStorage = makeStorage([makeJob(8)]);
    queueStorage.getUser.mockResolvedValue(makeUser(8, 'firebase-8'));

    await processAccountErasureJobs(1, queueStorage as never);

    expect(queueStorage.markAccountErasureProviderStep).toHaveBeenCalledWith(8, 'claim-8', 'firebase');
    expect(queueStorage.completeAccountErasureJob).toHaveBeenCalledWith(8, 8, 'claim-8');
    expect(provider.deleteLegacyLocalMediaForUser).toHaveBeenCalledWith([undefined, undefined]);
    expect(queueStorage.destroyUserSessions).toHaveBeenCalledWith(8);
    expect(queueStorage.failAccountErasureJob).not.toHaveBeenCalled();
  });

  it('records provider failures as transient retryable work', async () => {
    provider.deleteOwnedMediaForUser.mockReset().mockRejectedValue(new Error('storage unavailable'));
    provider.deleteLegacyLocalMediaForUser.mockReset().mockResolvedValue(undefined);
    const queueStorage = makeStorage([makeJob(9)]);

    await processAccountErasureJobs(1, queueStorage as never);

    expect(queueStorage.failAccountErasureJob).toHaveBeenCalledWith(
      9,
      'claim-9',
      'Error',
      'transient',
    );
  });

  it('does not report completion when legacy media cleanup is unavailable', async () => {
    provider.deleteOwnedMediaForUser.mockReset().mockResolvedValue(undefined);
    provider.deleteLegacyLocalMediaForUser.mockReset().mockRejectedValue(new Error('legacy storage unavailable'));
    const queueStorage = makeStorage([makeJob(10)]);

    await processAccountErasureJobs(1, queueStorage as never);

    expect(queueStorage.completeAccountErasureJob).not.toHaveBeenCalled();
    expect(queueStorage.failAccountErasureJob).toHaveBeenCalledWith(
      10,
      'claim-10',
      'Error',
      'transient',
    );
  });
});