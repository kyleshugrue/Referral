import type { User } from '@shared/schema';

/**
 * Pure profile/matching-readiness logic, split out of the user routes so it
 * can be unit tested without importing the DB-connected route module.
 */

const SYSTEM_DEFAULTS = {
  industry: 'Technology',
  currentLocation: 'Remote',
  currentCompany: 'Not Specified',
} as const;

/**
 * True if the user has all required fields for AI matching:
 * - desiredLocations (at least 1)
 * - desiredCompanies (at least 1)
 * - industry (not system default "Technology")
 * - currentLocation (not system default "Remote")
 * - currentCompany (not system default "Not Specified")
 */
export function hasRequiredFieldsForMatching(user: User): boolean {
  const hasDesiredLocations = Array.isArray(user.desiredLocations) && user.desiredLocations.length > 0;
  const hasDesiredCompanies = Array.isArray(user.desiredCompanies) && user.desiredCompanies.length > 0;
  const hasValidIndustry = Boolean(user.industry && user.industry !== SYSTEM_DEFAULTS.industry);
  const hasValidCurrentLocation = Boolean(user.currentLocation && user.currentLocation !== SYSTEM_DEFAULTS.currentLocation);
  const hasValidCurrentCompany = Boolean(user.currentCompany && user.currentCompany !== SYSTEM_DEFAULTS.currentCompany);

  return (
    hasDesiredLocations &&
    hasDesiredCompanies &&
    hasValidIndustry &&
    hasValidCurrentLocation &&
    hasValidCurrentCompany
  );
}

export interface QueueMatchJobsDecision {
  shouldQueue: boolean;
  reason: string;
}

/**
 * Decide whether initial AI-match jobs should be queued for a user. Checks:
 * - Jobs haven't already been queued
 * - Email is verified (quality control)
 * - hasMinimumMatchData flag is set (computed elsewhere from required fields)
 */
export function shouldQueueInitialMatchJobs(user: User): QueueMatchJobsDecision {
  if (user.initialMatchJobsQueued) {
    return {
      shouldQueue: false,
      reason: `Initial match jobs already queued at ${user.initialMatchJobsQueuedAt}`,
    };
  }

  if (!user.emailVerified) {
    return {
      shouldQueue: false,
      reason: 'Email not verified yet - will queue jobs after verification',
    };
  }

  if (!user.hasMinimumMatchData) {
    return {
      shouldQueue: false,
      reason: 'Missing minimum required data for AI matching (companies, locations, industry, current employer, current location)',
    };
  }

  return {
    shouldQueue: true,
    reason: 'All requirements met - ready to queue initial match jobs',
  };
}
