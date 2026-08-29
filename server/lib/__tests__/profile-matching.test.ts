import { describe, it, expect } from 'vitest';
import { hasRequiredFieldsForMatching, shouldQueueInitialMatchJobs } from '../profile-matching';
import type { User } from '@shared/schema';

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    desiredLocations: ['NYC'],
    desiredCompanies: ['Acme'],
    industry: 'Finance',
    currentLocation: 'Boston',
    currentCompany: 'Initech',
    emailVerified: true,
    hasMinimumMatchData: true,
    initialMatchJobsQueued: false,
    initialMatchJobsQueuedAt: null,
    ...overrides,
  } as User;
}

describe('hasRequiredFieldsForMatching (profile operation)', () => {
  it('is true when all real (non-default) fields are present', () => {
    expect(hasRequiredFieldsForMatching(baseUser())).toBe(true);
  });

  it('is false when desiredLocations or desiredCompanies are empty', () => {
    expect(hasRequiredFieldsForMatching(baseUser({ desiredLocations: [] }))).toBe(false);
    expect(hasRequiredFieldsForMatching(baseUser({ desiredCompanies: [] }))).toBe(false);
  });

  it('is false when industry/location/company still hold system defaults', () => {
    expect(hasRequiredFieldsForMatching(baseUser({ industry: 'Technology' }))).toBe(false);
    expect(hasRequiredFieldsForMatching(baseUser({ currentLocation: 'Remote' }))).toBe(false);
    expect(hasRequiredFieldsForMatching(baseUser({ currentCompany: 'Not Specified' }))).toBe(false);
  });
});

describe('shouldQueueInitialMatchJobs (profile operation)', () => {
  it('queues jobs when email is verified, data is ready, and nothing queued yet', () => {
    expect(shouldQueueInitialMatchJobs(baseUser())).toEqual({
      shouldQueue: true,
      reason: 'All requirements met - ready to queue initial match jobs',
    });
  });

  it('does not re-queue jobs that were already queued', () => {
    const result = shouldQueueInitialMatchJobs(
      baseUser({ initialMatchJobsQueued: true, initialMatchJobsQueuedAt: '2024-01-01T00:00:00.000Z' })
    );
    expect(result.shouldQueue).toBe(false);
    expect(result.reason).toContain('already queued');
  });

  it('withholds queueing until email is verified', () => {
    const result = shouldQueueInitialMatchJobs(baseUser({ emailVerified: false }));
    expect(result.shouldQueue).toBe(false);
    expect(result.reason).toContain('Email not verified');
  });

  it('withholds queueing when minimum match data is missing', () => {
    const result = shouldQueueInitialMatchJobs(baseUser({ hasMinimumMatchData: false }));
    expect(result.shouldQueue).toBe(false);
    expect(result.reason).toContain('Missing minimum required data');
  });
});
