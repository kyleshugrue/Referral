import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: {
    resolveUserForFirebaseIdentity: vi.fn(),
    createUser: vi.fn(),
    getUserByMediaReference: vi.fn(),
  },
}));

vi.mock('../storage', () => ({
  storage: mocks.storage,
  FirebaseIdentityConflictError: class FirebaseIdentityConflictError extends Error {},
}));

vi.mock('../services/firebase-storage', () => ({
  firebaseStorageService: {
    normalizeMediaReference: vi.fn((value: unknown) => value),
    isMediaReferenceOwnedByFirebaseUid: vi.fn(),
  },
}));

vi.mock('../services/simple-match-job-helper', () => ({
  simpleMatchJobHelper: {},
}));

vi.mock('../lib/privacy-dto', () => ({
  toSelfUserDto: (user: unknown) => user,
}));

import { registerFirebaseUser } from './register';

function requestDouble() {
  return {
    body: {},
    registrant: {
      uid: 'firebase-user-1',
      email: 'person@example.invalid',
      emailVerified: true,
    },
  };
}

function responseDouble() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('Firebase registration identity resolution', () => {
  beforeEach(() => {
    mocks.storage.resolveUserForFirebaseIdentity.mockReset();
    mocks.storage.createUser.mockReset();
    mocks.storage.getUserByMediaReference.mockReset();
  });

  it('does not create an account when the identity lookup fails', async () => {
    mocks.storage.resolveUserForFirebaseIdentity.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const response = responseDouble();

    await registerFirebaseUser(requestDouble() as never, response as never);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(mocks.storage.createUser).not.toHaveBeenCalled();
  });

  it('recovers an expected unique-constraint race by resolving the winner', async () => {
    const createdByConcurrentRequest = { id: 42, firebaseUid: 'firebase-user-1' };
    mocks.storage.resolveUserForFirebaseIdentity
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(createdByConcurrentRequest);
    mocks.storage.createUser.mockRejectedValueOnce({ code: '23505' });
    const response = responseDouble();

    await registerFirebaseUser(requestDouble() as never, response as never);

    expect(mocks.storage.resolveUserForFirebaseIdentity).toHaveBeenCalledTimes(2);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(createdByConcurrentRequest);
  });
});