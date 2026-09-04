import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: {
    resolveUserForFirebaseIdentity: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    linkUserToFirebaseUid: vi.fn(),
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

import { partialRegisterFirebaseUser, registerFirebaseUser } from './register';

const registrant = {
  uid: 'firebase-user-1',
  email: 'token@example.invalid',
  emailVerified: true,
};

function requestDouble(body: unknown) {
  return { body, registrant };
}

function responseDouble() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('registration input and identity boundaries', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks.storage)) mock.mockReset();
  });

  it('rejects server-owned fields and unknown keys instead of dropping them', async () => {
    const response = responseDouble();

    await registerFirebaseUser(
      requestDouble({ accountStatus: 'active', fullName: 'Person' }) as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.storage.resolveUserForFirebaseIdentity).not.toHaveBeenCalled();
    expect(mocks.storage.createUser).not.toHaveBeenCalled();
  });

  it('uses the verified token email and never persists body identity fields', async () => {
    const createdUser = { id: 9, email: registrant.email, firebaseUid: registrant.uid };
    mocks.storage.resolveUserForFirebaseIdentity.mockResolvedValue(undefined);
    mocks.storage.createUser.mockResolvedValue(createdUser);
    const response = responseDouble();

    await registerFirebaseUser(
      requestDouble({
        email: 'attacker@example.invalid',
        username: 'attacker',
        firebaseUid: 'attacker-uid',
        fullName: 'Person',
      }) as never,
      response as never,
    );

    expect(mocks.storage.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: registrant.email,
        firebaseUid: registrant.uid,
        fullName: 'Person',
      }),
    );
    expect(mocks.storage.createUser.mock.calls[0][0]).not.toHaveProperty('username');
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('rejects a suspended account before relinking or updating it', async () => {
    mocks.storage.resolveUserForFirebaseIdentity.mockResolvedValue({
      id: 12,
      accountStatus: 'suspended',
      firebaseUid: null,
      email: registrant.email,
    });
    const response = responseDouble();

    await partialRegisterFirebaseUser(
      requestDouble({ fullName: 'Should not update' }) as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(mocks.storage.linkUserToFirebaseUid).not.toHaveBeenCalled();
    expect(mocks.storage.updateUser).not.toHaveBeenCalled();
    expect(mocks.storage.createUser).not.toHaveBeenCalled();
  });

  it('accepts a legitimate onboarding payload and persists only profile fields', async () => {
    const createdUser = { id: 10, accountStatus: 'active', email: registrant.email };
    mocks.storage.resolveUserForFirebaseIdentity.mockResolvedValue(undefined);
    mocks.storage.createUser.mockResolvedValue(createdUser);
    const response = responseDouble();

    await registerFirebaseUser(
      requestDouble({
        fullName: 'Person',
        currentCompany: 'Example',
        yearsOfExperience: 4,
        interests: ['design'],
        profileVisible: true,
      }) as never,
      response as never,
    );

    expect(mocks.storage.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Person',
        currentCompany: 'Example',
        yearsOfExperience: 4,
        interests: ['design'],
      }),
    );
    expect(mocks.storage.createUser.mock.calls[0][0]).not.toHaveProperty('accountStatus');
  });
});