import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('./background-job-queue', () => ({ backgroundJobQueue: {} }));

import {
  providerEvidencePasses,
  validateApprovedLegacyAccountRepair,
  type ApprovedLegacyAccountRepair,
} from './legacy-account-reconciliation';

const approval: ApprovedLegacyAccountRepair = {
  userId: 12,
  expectedFirebaseUid: 'firebase-uid',
  expectedEmail: 'Owner@Example.com',
  legacyEvidence: 'external legacy source',
  completionEvidence: 'external completion source',
  approvedBy: 'release owner',
  approvedAt: '2026-09-01T00:00:00.000Z',
};

describe('legacy account reconciliation guards', () => {
  it('requires all provider identity gates', () => {
    expect(providerEvidencePasses(approval, {
      uid: 'firebase-uid',
      email: ' owner@example.com ',
      emailVerified: true,
    })).toBe(true);

    expect(providerEvidencePasses(approval, {
      uid: 'different-uid',
      email: 'owner@example.com',
      emailVerified: true,
    })).toBe(false);
    expect(providerEvidencePasses(approval, {
      uid: 'firebase-uid',
      email: 'different@example.com',
      emailVerified: true,
    })).toBe(false);
    expect(providerEvidencePasses(approval, {
      uid: 'firebase-uid',
      email: 'owner@example.com',
      emailVerified: false,
    })).toBe(false);
  });

  it('rejects incomplete approval evidence', () => {
    expect(() => validateApprovedLegacyAccountRepair({
      ...approval,
      completionEvidence: '',
    })).toThrow('completionEvidence is required');
    expect(() => validateApprovedLegacyAccountRepair({
      ...approval,
      approvedAt: 'not-a-date',
    })).toThrow('approvedAt must be an ISO date');
  });
});