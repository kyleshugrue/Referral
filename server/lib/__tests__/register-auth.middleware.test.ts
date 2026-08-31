import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('../firebase-admin', () => ({
  auth: {
    verifyIdToken: mocks.verifyIdToken,
  },
}));

import { requireVerifiedFirebaseUser } from '../register-auth';

function responseDouble() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('requireVerifiedFirebaseUser', () => {
  beforeEach(() => {
    mocks.verifyIdToken.mockReset();
  });

  it('rejects when Firebase ID-token verification fails', async () => {
    mocks.verifyIdToken.mockRejectedValueOnce(new Error('verification failed'));
    const response = responseDouble();
    const next = vi.fn();

    await requireVerifiedFirebaseUser(
      { headers: { authorization: 'Bearer bad' }, body: {} } as never,
      response as never,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Invalid or expired Firebase ID token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token before contacting Firebase', async () => {
    const response = responseDouble();
    const next = vi.fn();

    await requireVerifiedFirebaseUser(
      { headers: {}, body: {} } as never,
      response as never,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});